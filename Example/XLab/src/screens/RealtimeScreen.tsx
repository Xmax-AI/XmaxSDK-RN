import { launchImageLibrary } from 'react-native-image-picker';
import { RealtimeToolbar } from '../realtime/RealtimeToolbar';
import { RealtimeAudioVolumeMenu } from '../realtime/RealtimeAudioVolumeMenu';
import { makeRealtimeFileVideoSource } from '../external/RealtimeFileVideoSource';
import { RealtimeStatisticsPanel } from '../realtime/RealtimeStatisticsPanel';
import {
  RemoteMediaFrameReception,
  type RecordingState,
} from '../realtime/RemoteMediaFrameReception';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '@xmaxai/react-native-sdk';
import { errorMessageKey } from '../localization/ErrorMessages';
import { useLocalization } from '../localization/LocalizationProvider';
import { english, type MessageKey } from '../localization/messages';
import { RealtimeGenerationOperations } from '../realtime/RealtimeGenerationOperations';
import { XLabTrajectoryRenderer } from '../realtime/XLabTrajectoryRenderer';
import { uploadTouchAnimationReference } from '../realtime/TouchAnimationReference';
import { realtimeCategories } from '../realtime/RealtimeReferenceCatalog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  XmaxClient,
  XmaxLoggerOption,
  XmaxRealtimeDualVideo,
  RealtimeModel,
  type RealtimeVideoFormat,
  type RealtimeQualityLevel,
  VideoContentMode,
  realtimeModelSpecifications,
  type RealtimeContext,
  RealtimeConnectionState,
  XmaxError,
  XmaxErrorCode,
  type XmaxEnvironment,
  type XmaxRealtimeManaging,
  type RealtimeMediaStream,
  type RealtimeVideoTrack,
  type RealtimeState,
  type RealtimeNetworkQuality,
} from '@xmaxai/react-native-sdk';
import { RealtimeControlPanel } from '../realtime/RealtimeControlPanel';
import { RealtimeLoadingOverlay } from '../realtime/RealtimeLoadingOverlay';
import {
  RealtimeErrorToast,
  type RealtimeErrorNotice,
} from '../realtime/RealtimeErrorToast';

/** Generation options retained when replacing local file input. */
interface GenerationOptions {
  readonly touchAnimation?: boolean;
  readonly faceRestoration?: boolean;
}

/** The selected generation conditions, independent of the local file. */
interface GenerationIntent {
  readonly context: RealtimeContext;
  readonly options: GenerationOptions;
  readonly onFailure?: (() => void) | undefined;
}

/**
 * Owns camera or image preview and its prompt/reference generation lifecycle.
 *
 * Closes the realtime manager on unmount or backgrounding. Foreground recovery
 * restores local preview without automatically restarting generation.
 * Native back gestures remain uninterrupted; cancelling a swipe keeps preview alive.
 * Camera preview extends behind the top system area. Image preview starts below
 * the top controls and uses fit scaling. Controls retain safe-area padding.
 */
export function RealtimeScreen({
  model = RealtimeModel.x2_1_1_preview_cn,
  apiKey,
  environment,
  onBack,
  fileURL: initialFileURL,
  externalFileURL: initialExternalFileURL,
  customTrajectory = false,
  imageContentType: initialImageContentType,
  entryReady = true,
}: {
  /** Model captured when entering the page; defaults to the China X2.1.1 preview model. */
  model?: RealtimeModel;
  /** Credential captured for the selected service region. */
  apiKey: string;
  environment: XmaxEnvironment;
  onBack: () => void;
  /** Omit for camera capture; otherwise keep this source readable until exit. */
  fileURL?: string;
  /** App-owned video decoding through the SDK external-source API. */
  externalFileURL?: string | undefined;
  /** Selects the iOS XLab pink/blue renderer for the custom rendering example. */
  customTrajectory?: boolean;
  imageContentType?: string | undefined;
  /** The native route enables media startup only after its opening transition. */
  entryReady?: boolean;
}) {
  const { t } = useLocalization();
  const [input, setInput] = useState({
    fileURL: initialFileURL,
    externalFileURL: initialExternalFileURL,
    contentType: initialImageContentType,
  });
  const { fileURL, externalFileURL, contentType: imageContentType } = input;
  const [audioMenuVisible, setAudioMenuVisible] = useState(false);
  const [remoteVolume, setRemoteVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const savedRemoteVolume = useRef(0);
  const volumeVersion = useRef(0);
  const pickerOpen = useRef(false);
  const [pickingMedia, setPickingMedia] = useState(false);
  const lastIntent = useRef<GenerationIntent | null>(null);
  const pendingRestart = useRef<GenerationIntent | null>(null);
  const submitLatest = useRef<
    (
      context: RealtimeContext,
      options?: GenerationOptions,
      onFailure?: () => void,
    ) => Promise<void>
  >(async () => {});
  const [networkQuality, setNetworkQuality] =
    useState<RealtimeNetworkQuality | null>(null);
  const [controlPanelHeight, setControlPanelHeight] = useState(0);
  const [statisticsVisible, setStatisticsVisible] = useState(false);
  const frameReception = useRef<RemoteMediaFrameReception | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingVersion = useRef(0);
  const [uplinkStatistics, setUplinkStatistics] =
    useState<UplinkVideoStatistics | null>(null);
  const [downlinkStatistics, setDownlinkStatistics] =
    useState<DownlinkVideoStatistics | null>(null);

  const [cameraFormat, setCameraFormat] = useState<RealtimeVideoFormat | null>(
    null,
  );
  const [uplinkLevel, setUplinkLevel] = useState<RealtimeQualityLevel | null>(
    null,
  );
  const [downlinkLevel, setDownlinkLevel] =
    useState<RealtimeQualityLevel | null>(null);

  /** Reads acknowledged camera and transport configuration from the current manager. */
  const refreshConfiguration = useCallback((realtime: XmaxRealtimeManaging) => {
    setCameraFormat(realtime.currentCameraVideoFormat ?? null);
    setUplinkLevel(realtime.uplinkQualityLevel ?? null);
    setDownlinkLevel(realtime.downlinkQualityLevel ?? null);
  }, []);

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [landscapeLayout, setLandscapeLayout] = useState<boolean | null>(null);
  const trajectoryRenderer = useMemo(
    () => (customTrajectory ? new XLabTrajectoryRenderer() : null),
    [customTrajectory],
  );
  const client = useRef<XmaxClient | null>(null);
  const operations = useRef<RealtimeGenerationOperations | null>(null);
  const teardown = useRef<Promise<void>>(Promise.resolve());
  const mediaBusy = useRef(true);
  const touchReference = useRef<string | null>(null);
  const manager = useRef<XmaxRealtimeManaging | null>(null),
    local = useRef<RealtimeMediaStream | null>(null);
  const alive = useRef(false),
    epoch = useRef(0);

  const [localTrack, setLocalTrack] = useState<RealtimeVideoTrack | null>(null),
    [remoteTrack, setRemoteTrack] = useState<RealtimeVideoTrack | null>(null);
  const [state, setState] = useState<RealtimeState>({
    connectionState: RealtimeConnectionState.idle,
    sessionID: null,
    taskID: null,
    reason: null,
  });
  const [busy, setBusy] = useState(true),
    [loading, setLoading] = useState(true),
    [generationRequested, setGenerationRequested] = useState(false),
    [error, setError] = useState<RealtimeErrorNotice | null>(null),
    [prompt, setPrompt] = useState('');

  const nextOperation = useCallback(() => {
    return ++epoch.current;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const showError = useCallback((value: unknown) => {
    const failure = XmaxError.from(value);

    if (alive.current && failure.code !== XmaxErrorCode.cancelled) {
      setError({
        message: failure.message,
        // Match iOS: preserve the SDK/service explanation instead of replacing
        // every API failure (authentication, quota, etc.) with generic app copy.
        ...(failure.message.trim()
          ? {}
          : { messageKey: errorMessageKey(failure.code) }),
        permissionError: [
          XmaxErrorCode.cameraPermissionDenied,
          XmaxErrorCode.microphonePermissionDenied,
        ].includes(failure.code),
      });
    }
  }, []);

  /** Keeps asynchronous recording completions from restoring obsolete toolbar states. */
  const updateRecordingState = useCallback((value: RecordingState) => {
    recordingStateRef.current = value;
    if (alive.current) setRecordingState(value);
  }, []);

  const recordingNotice = useCallback((failure?: unknown) => {
    if (!alive.current) return;
    const message = failure instanceof Error ? failure.message : '';
    const key: MessageKey = !failure
      ? 'record.saved'
      : message.startsWith('record.') && message in english
      ? (message as MessageKey)
      : 'record.failed';
    setError({
      message: '',
      messageKey: key,
      permissionError: key === 'record.permission',
      ...(!failure ? { kind: 'success' as const } : {}),
    });
  }, []);

  /** Finishes the active recording once, including pending permission or save work. */
  const finishRecording = useCallback(
    async (receiver = frameReception.current) => {
      if (!receiver || recordingStateRef.current === 'idle') return;
      const version = ++recordingVersion.current;
      updateRecordingState('saving');
      try {
        const saved = await receiver.stopRecording();
        if (saved && version === recordingVersion.current) recordingNotice();
      } catch (failure) {
        if (version === recordingVersion.current) recordingNotice(failure);
      } finally {
        if (version === recordingVersion.current) updateRecordingState('idle');
      }
    },
    [recordingNotice, updateRecordingState],
  );

  /** Polls only recording failures; raw frames are encoded entirely in native code. */
  useEffect(() => {
    if (recordingState !== 'recording') return;
    let current = true;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      const receiver = frameReception.current;
      void receiver
        ?.getRecordingError()
        .then(failure => {
          if (current && failure && frameReception.current === receiver) {
            ++recordingVersion.current;
            updateRecordingState('idle');
            recordingNotice(new Error(failure));
          }
        })
        .catch(recordingNotice)
        .finally(() => {
          reading = false;
        });
    }, 500);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [recordingState, recordingNotice, updateRecordingState]);

  useEffect(() => {
    if (
      !generationRequested ||
      [
        RealtimeConnectionState.idle,
        RealtimeConnectionState.ready,
        RealtimeConnectionState.disconnecting,
      ].includes(state.connectionState)
    )
      void finishRecording();
  }, [generationRequested, state.connectionState, finishRecording]);

  async function toggleRecording() {
    const receiver = frameReception.current;
    if (!receiver) return;
    if (recordingStateRef.current === 'recording')
      return finishRecording(receiver);
    if (recordingStateRef.current !== 'idle') return;
    if (!generationRequested) {
      recordingNotice(new Error('record.generation.required'));
      return;
    }
    const version = ++recordingVersion.current;
    updateRecordingState('preparing');
    try {
      await receiver.startRecording();
      if (
        version === recordingVersion.current &&
        frameReception.current === receiver
      )
        updateRecordingState('recording');
    } catch (failure) {
      if (version === recordingVersion.current) {
        updateRecordingState('idle');
        recordingNotice(failure);
      }
    }
  }

  /**
   * Starts local preview and ignores results from an obsolete screen operation.
   */
  const preview = useCallback(
    async (realtime: XmaxRealtimeManaging) => {
      const token = nextOperation();
      mediaBusy.current = true;
      setGenerationRequested(false);

      setBusy(true);
      setLoading(true);
      setError(null);

      try {
        let stream: RealtimeMediaStream;
        if (input.externalFileURL) {
          const source = await makeRealtimeFileVideoSource(
            input.externalFileURL,
            realtimeModelSpecifications[model].defaultCameraVideoFormat,
          );
          if (!alive.current || token !== epoch.current) {
            await source.stop();
            return;
          }
          try {
            stream = await realtime.createExternalVideoStream(source);
          } catch (failure) {
            await source.stop();
            throw failure;
          }
        } else
          stream = input.fileURL
            ? await realtime.createLocalImageStream({ fileURL: input.fileURL })
            : await realtime.createLocalCameraStream();

        if (alive.current && token === epoch.current) {
          local.current = stream;
          setLocalTrack(stream.videoTrack);
          refreshConfiguration(realtime);
          setRemoteVolume(realtime.remoteAudioVolume);
          savedRemoteVolume.current = realtime.remoteAudioVolume;
          setMuted(false);
          const restart = pendingRestart.current;
          pendingRestart.current = null;
          if (restart) {
            mediaBusy.current = false;
            void Promise.resolve().then(() => {
              if (
                alive.current &&
                manager.current === realtime &&
                token === epoch.current
              )
                return submitLatest.current(
                  restart.context,
                  restart.options,
                  restart.onFailure,
                );
            });
          }
        }
      } catch (failure) {
        if (token === epoch.current) showError(failure);
      } finally {
        if (alive.current && token === epoch.current) {
          const preparing =
            realtime.currentState.connectionState ===
            RealtimeConnectionState.preparing;
          mediaBusy.current = preparing;
          setBusy(preparing);
          setLoading(preparing);
        }
      }
    },
    [showError, nextOperation, input, model, refreshConfiguration],
  );

  useEffect(() => {
    if (!entryReady) return;
    let active = true;

    alive.current = true;
    mediaBusy.current = true;
    setLocalTrack(null);
    setRemoteTrack(null);
    setGenerationRequested(false);
    setBusy(true);
    setLoading(true);
    setState({
      connectionState: RealtimeConnectionState.idle,
      sessionID: null,
      taskID: null,
      reason: null,
    });

    const configuredClient = new XmaxClient({
      apiKey,
      environment,
      loggerOptions: XmaxLoggerOption.all,
    });
    client.current = configuredClient;
    touchReference.current = null;
    setAudioMenuVisible(false);
    setNetworkQuality(null);
    const realtime = configuredClient.createRealtimeManager({
      model,
    });
    const reception = input.fileURL
      ? null
      : new RemoteMediaFrameReception(realtime);
    frameReception.current = reception;

    const generation = new RealtimeGenerationOperations(() =>
      realtime.disconnect(),
    );
    operations.current = generation;
    manager.current = realtime;
    void realtime.setUplinkVideoStatisticsListener(value => {
      if (active && alive.current && manager.current === realtime) {
        setUplinkStatistics(value);
        refreshConfiguration(realtime);
      }
    });
    void realtime.setDownlinkVideoStatisticsListener(value => {
      if (active && alive.current && manager.current === realtime) {
        setDownlinkStatistics(value);
        refreshConfiguration(realtime);
      }
    });

    void realtime.setNetworkQualityListener(value => {
      if (active && alive.current && manager.current === realtime) {
        setNetworkQuality(value);
        refreshConfiguration(realtime);
      }
    });

    void realtime.setStateListener(value => {
      if (!active || !alive.current || manager.current !== realtime) return;

      setState(value);
      refreshConfiguration(realtime);
      if (value.connectionState === RealtimeConnectionState.idle) {
        local.current = null;
        setLocalTrack(null);
      }
      if (
        [RealtimeConnectionState.idle, RealtimeConnectionState.ready].includes(
          value.connectionState,
        )
      )
        setRemoteTrack(null);
      if (
        value.connectionState === RealtimeConnectionState.ready &&
        mediaBusy.current
      ) {
        mediaBusy.current = false;
        setBusy(false);
        setLoading(false);
      }
      if (
        value.reason?.type === 'failure' &&
        AppState.currentState === 'active'
      ) {
        mediaBusy.current = false;
        setGenerationRequested(false);
        setBusy(false);
        setLoading(false);
        showError(value.reason.error);
      }
    });
    /** Registers native output before preview can start a generation request. */
    const startPreview = async () => {
      const isCurrent = () =>
        active &&
        alive.current &&
        manager.current === realtime &&
        AppState.currentState === 'active';
      if (!isCurrent()) return;
      try {
        await reception?.start();
      } catch (failure) {
        await reception?.close().catch(() => {});
        if (isCurrent()) {
          setBusy(false);
          setLoading(false);
          showError(failure);
        }
        return;
      }
      if (isCurrent()) return preview(realtime);
    };
    void teardown.current.then(startPreview);

    let previous = AppState.currentState;
    let closing: Promise<void> = Promise.resolve();
    const appState = AppState.addEventListener('change', next => {
      if (next === 'background') {
        void finishRecording(reception);
        nextOperation();
        mediaBusy.current = true;
        setBusy(true);
        setGenerationRequested(false);
        pendingRestart.current = null;
        lastIntent.current = null;
        setAudioMenuVisible(false);
        setLoading(false);
        local.current = null;
        setLocalTrack(null);
        setRemoteTrack(null);
        closing = generation
          .cancel(() => realtime.close())
          .catch(failure => {
            if (
              manager.current === realtime &&
              AppState.currentState === 'active'
            )
              showError(failure);
          });
        teardown.current = closing;
      } else if (next === 'active' && previous === 'background') {
        const token = nextOperation();
        void closing.then(() => {
          if (
            active &&
            alive.current &&
            manager.current === realtime &&
            token === epoch.current &&
            AppState.currentState === 'active'
          )
            return startPreview();
        });
      }
      if (next !== 'inactive') previous = next;
    });

    // Release on unmount without cancelling and replaying the native back gesture.
    // Invalidate pending work first so late results cannot restore the removed screen.
    return () => {
      void finishRecording(reception);
      active = false;
      alive.current = false;
      nextOperation();
      mediaBusy.current = true;
      operations.current = null;
      client.current = null;
      manager.current = null;
      if (frameReception.current === reception) frameReception.current = null;
      local.current = null;
      appState.remove();
      void realtime.setStateListener(null);
      void realtime.setNetworkQualityListener(null);
      void realtime.setUplinkVideoStatisticsListener(null);
      void realtime.setDownlinkVideoStatisticsListener(null);
      const precedingCleanup = teardown.current;
      const cleaning = generation
        .cancel(async () => {
          try {
            await reception?.close();
          } finally {
            await realtime.close();
          }
        })
        .catch(() => {});
      teardown.current = Promise.all([precedingCleanup, cleaning]).then(
        () => {},
      );
    };
  }, [
    entryReady,
    apiKey,
    environment,
    model,
    input.fileURL,
    preview,
    refreshConfiguration,
    finishRecording,
    showError,
    nextOperation,
  ]);

  /**
   * Replaces the generation task and displays its confirmed remote stream.
   */
  const submit = async (
    context: RealtimeContext,
    options: GenerationOptions = {},
    onFailure?: () => void,
  ) => {
    if (
      !alive.current ||
      !manager.current ||
      !local.current ||
      !operations.current ||
      mediaBusy.current ||
      AppState.currentState !== 'active'
    )
      return;
    if (!apiKey) {
      setError({
        message: t('realtime.api.required'),
        messageKey: 'realtime.api.required',
        permissionError: false,
      });
      onFailure?.();
      return;
    }
    if (!options.touchAnimation && !context.prompt.trim()) {
      setError({
        message: t('realtime.prompt.required'),
        messageKey: 'realtime.prompt.required',
        permissionError: false,
      });
      onFailure?.();
      return;
    }

    Keyboard.dismiss();

    const token = nextOperation();
    const realtime = manager.current;
    const generation = operations.current;
    const stream = local.current;
    const configuredClient = client.current!;

    lastIntent.current = { context, options, onFailure };
    setGenerationRequested(true);
    setBusy(true);
    setLoading(true);
    setError(null);

    try {
      await generation.run(async signal => {
        if (options.touchAnimation && fileURL && !touchReference.current) {
          const reference = await uploadTouchAnimationReference(
            configuredClient.createStorageManager(),
            fileURL,
            imageContentType,
            signal,
          );
          if (signal.aborted || !alive.current || token !== epoch.current)
            return;
          touchReference.current = reference;
        }
        if (options.touchAnimation)
          context = {
            ...context,
            referencePath: fileURL ? touchReference.current : null,
          };
        if (signal.aborted || token !== epoch.current) return;
        const remote = await realtime.startGeneration({
          localStream: stream,
          context,
          faceRestoration: options.faceRestoration ?? false,
        });
        if (signal.aborted || !alive.current || token !== epoch.current) return;
        setRemoteTrack(remote.videoTrack);
      });
    } catch (failure) {
      if (alive.current && token === epoch.current) {
        if (
          realtime.currentState.connectionState !==
          RealtimeConnectionState.generating
        ) {
          setGenerationRequested(false);
          setRemoteTrack(null);
          onFailure?.();
        }
        showError(failure);
      }
    } finally {
      if (alive.current && token === epoch.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  };

  submitLatest.current = submit;

  /**
   * Disconnects generation while preserving the local media preview.
   */
  const stop = async () => {
    if (!alive.current || !operations.current || mediaBusy.current) return;
    const token = nextOperation();

    lastIntent.current = null;
    pendingRestart.current = null;
    setGenerationRequested(false);
    setBusy(true);
    setLoading(false);

    try {
      // Keep the container mounted until SDK native hiding acknowledges teardown.
      // Removing it here unregisters the hide callback before disconnect can use it.
      await operations.current.cancel();
    } catch (failure) {
      if (token === epoch.current) showError(failure);
    } finally {
      if (alive.current && token === epoch.current) {
        setRemoteTrack(null);
        setBusy(false);
      }
    }
  };

  /**
   * Switches the camera and applies the result only to the active operation.
   */
  const flip = async () => {
    if (busy || mediaBusy.current || !manager.current) return;

    const token = nextOperation();
    mediaBusy.current = true;

    setBusy(true);

    try {
      const stream = await manager.current.switchCamera();

      if (alive.current && token === epoch.current) {
        local.current = stream;
        setLocalTrack(stream.videoTrack);
      }
    } catch (failure) {
      if (token === epoch.current) showError(failure);
    } finally {
      if (alive.current && token === epoch.current) {
        mediaBusy.current = false;
        setBusy(false);
      }
    }
  };

  /** Applies a manual transport tier through the SDK; subsequent network adaptation remains enabled. */
  async function changeQualityLevel(
    level: RealtimeQualityLevel,
    downlink: boolean,
  ) {
    const realtime = manager.current;
    if (
      !realtime ||
      busy ||
      mediaBusy.current ||
      realtime.currentState.connectionState !==
        RealtimeConnectionState.generating
    )
      return;
    const token = nextOperation();
    mediaBusy.current = true;
    setBusy(true);
    try {
      if (downlink) await realtime.setDownlinkQualityLevel(level);
      else await realtime.setUplinkQualityLevel(level);
    } catch (failure) {
      if (token === epoch.current) showError(failure);
    } finally {
      if (alive.current && token === epoch.current) {
        refreshConfiguration(realtime);
        mediaBusy.current = false;
        setBusy(false);
      }
    }
  }

  /** Replaces file input after cleanup and restores the previous generation conditions. */
  async function replaceMedia() {
    if (pickerOpen.current || (!fileURL && !externalFileURL)) return;
    pickerOpen.current = true;
    setPickingMedia(true);
    setAudioMenuVisible(false);
    const token = epoch.current;
    try {
      const result = await launchImageLibrary({
        mediaType: externalFileURL ? 'video' : 'photo',
        selectionLimit: 1,
        assetRepresentationMode: 'current',
      });
      if (
        !alive.current ||
        token !== epoch.current ||
        result.didCancel ||
        AppState.currentState !== 'active'
      )
        return;
      const asset = result.assets?.[0];
      if (result.errorCode || !asset?.uri)
        throw new Error(t('realtime.reference.readError'));
      pendingRestart.current =
        pendingRestart.current ??
        (generationRequested ? lastIntent.current : null);
      nextOperation();
      mediaBusy.current = true;
      setBusy(true);
      setLoading(true);
      setInput({
        fileURL: externalFileURL ? undefined : asset.uri,
        externalFileURL: externalFileURL ? asset.uri : undefined,
        contentType: asset.type,
      });
    } catch (failure) {
      if (alive.current && token === epoch.current) showError(failure);
    } finally {
      pickerOpen.current = false;
      if (alive.current) setPickingMedia(false);
    }
  }

  /** Applies remote playback volume while ignoring completions from retired managers. */
  async function applyRemoteVolume(value: number, remember = true) {
    const realtime = manager.current;
    if (!realtime) return;
    const version = ++volumeVersion.current;
    if (remember) {
      savedRemoteVolume.current = value;
      setMuted(false);
    }
    setRemoteVolume(value);
    try {
      await realtime.setRemoteAudioVolume(value);
    } catch (failure) {
      if (
        alive.current &&
        manager.current === realtime &&
        version === volumeVersion.current
      ) {
        setRemoteVolume(realtime.remoteAudioVolume);
        showError(failure);
      }
    }
  }

  const connected = [
    RealtimeConnectionState.connecting,
    RealtimeConnectionState.connected,
    RealtimeConnectionState.generating,
  ].includes(state.connectionState);
  const previewTop = fileURL || externalFileURL ? insets.top + 68 : 0;

  return (
    <View
      style={styles.page}
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width > 0 && layout.height > 0)
          setLandscapeLayout(layout.width > layout.height);
      }}
    >
      <View style={[styles.preview, { marginTop: previewTop }]}>
        <XmaxRealtimeDualVideo
          remoteVideoFadeInDuration={0}
          trajectoryRenderer={trajectoryRenderer}
          localTrack={localTrack}
          remoteTrack={remoteTrack}
          videoContentMode={
            fileURL ||
            externalFileURL ||
            (landscapeLayout ?? width > height) ||
            (cameraFormat !== null && cameraFormat.width > cameraFormat.height)
              ? VideoContentMode.fit
              : VideoContentMode.fill
          }
          style={StyleSheet.absoluteFill}
        />
        <RealtimeLoadingOverlay loading={loading} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.home')}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          { top: insets.top + 8, left: insets.left + 12 },
          pressed && styles.pressed,
        ]}
      >
        <Image
          source={require('../assets/realtime/realtime_nav_back.png')}
          style={styles.backIcon}
        />
      </Pressable>
      <RealtimeToolbar
        camera={!fileURL && !externalFileURL}
        external={!!externalFileURL}
        canFlip={!busy && !!localTrack}
        picking={pickingMedia}
        statisticsVisible={statisticsVisible}
        muted={muted}
        recording={!fileURL}
        recordingState={recordingState}
        onRecording={() => {
          void toggleRecording();
        }}
        top={insets.top}
        right={insets.right}
        onFlip={flip}
        onStatistics={() => setStatisticsVisible(value => !value)}
        onVolume={() => setAudioMenuVisible(value => !value)}
        onMute={() => {
          const next = !muted;
          setMuted(next);
          void applyRemoteVolume(next ? 0 : savedRemoteVolume.current, false);
        }}
        onGallery={() => {
          void replaceMedia();
        }}
      />
      {audioMenuVisible && (
        <RealtimeAudioVolumeMenu
          value={remoteVolume}
          top={insets.top + 62}
          right={insets.right + (!fileURL && !externalFileURL ? 72 : 12)}
          onChange={value => {
            void applyRemoteVolume(value);
          }}
          onDismiss={() => setAudioMenuVisible(false)}
        />
      )}
      {statisticsVisible && (
        <View
          style={[
            styles.statisticsPanel,
            {
              top: insets.top + 64,
              left: insets.left + 12,
              maxHeight: Math.max(
                0,
                height - insets.top - 64 - controlPanelHeight - 8,
              ),
            },
          ]}
        >
          <RealtimeStatisticsPanel
            uplink={uplinkStatistics}
            downlink={downlinkStatistics}
            networkQuality={networkQuality}
            uplinkLevel={uplinkLevel}
            downlinkLevel={downlinkLevel}
            canChange={
              state.connectionState === RealtimeConnectionState.generating
            }
            adjusting={busy}
            onUplinkChange={level => {
              void changeQualityLevel(level, false);
            }}
            onDownlinkChange={level => {
              void changeQualityLevel(level, true);
            }}
          />
        </View>
      )}
      <KeyboardAvoidingView
        onLayout={event =>
          setControlPanelHeight(event.nativeEvent.layout.height)
        }
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.bottom,
          { paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <RealtimeControlPanel
          initialCategoryID={fileURL ? 'mox' : 'charx'}
          bottomInset={insets.bottom}
          apiKey={apiKey}
          environment={environment}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={(context, faceRestoration, onFailure) => {
            void submit(context, { faceRestoration }, onFailure);
          }}
          onStop={() => {
            void stop();
          }}
          generating={
            state.connectionState === RealtimeConnectionState.generating
          }
          generationRequested={generationRequested}
          onInstruction={() => {
            void submit(
              {
                prompt: realtimeCategories.find(
                  category => category.id === 'mox',
                )!.defaultPrompt,
              },
              { touchAnimation: true },
            );
          }}
          connected={connected}
          canSubmit={!mediaBusy.current && !!localTrack}
        />
      </KeyboardAvoidingView>
      <RealtimeErrorToast
        notice={error}
        top={insets.top + 78}
        actionLabel={
          error?.kind === 'success'
            ? null
            : error?.permissionError
            ? t('common.settings')
            : !localTrack
            ? t('common.retry')
            : null
        }
        onDismiss={clearError}
        onAction={() => {
          if (error?.permissionError) {
            void Linking.openSettings().catch(showError);
          } else if (manager.current) {
            void preview(manager.current);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1, minHeight: 0, overflow: 'hidden' },
  backButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { width: 32, height: 32, resizeMode: 'contain' },
  statisticsPanel: { position: 'absolute', width: 184 },
  pressed: { opacity: 0.7 },
  bottom: { flexShrink: 0 },
});
