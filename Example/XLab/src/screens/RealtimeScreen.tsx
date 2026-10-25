import { makeRealtimeFileVideoSource } from '../external/RealtimeFileVideoSource';
import { RealtimeStatisticsPanel } from '../realtime/RealtimeStatisticsPanel';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '@xmaxai/react-native-sdk';
import { errorMessageKey } from '../localization/ErrorMessages';
import { useLocalization } from '../localization/LocalizationProvider';
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
  Text,
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
} from '@xmaxai/react-native-sdk';
import { RealtimeControlPanel } from '../realtime/RealtimeControlPanel';
import { RealtimeLoadingOverlay } from '../realtime/RealtimeLoadingOverlay';
import {
  RealtimeErrorToast,
  type RealtimeErrorNotice,
} from '../realtime/RealtimeErrorToast';
import type { BitrateOverride } from '../configuration/ConfigurationStore';

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
  bitrate = null,
  apiKey,
  environment,
  baseURL,
  onBack,
  fileURL,
  externalFileURL,
  customTrajectory = false,
  imageContentType,
  entryReady = true,
}: {
  /** Model captured when entering the page; defaults to the China X2.1.1 preview model. */
  model?: RealtimeModel;
  /** Upload kbps limits captured with the model; null keeps SDK defaults. */
  bitrate?: BitrateOverride | null;
  /** Credential captured for the selected service region. */
  apiKey: string;
  environment: XmaxEnvironment;
  /** Explicit API backend captured when entering the page. */
  baseURL?: string | undefined;
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
  const faceUpdateVersion = useRef(0);
  const [faceRestoration, setFaceRestoration] = useState(false);
  const [statisticsVisible, setStatisticsVisible] = useState(false);
  const [uplinkStatistics, setUplinkStatistics] =
    useState<UplinkVideoStatistics | null>(null);
  const [downlinkStatistics, setDownlinkStatistics] =
    useState<DownlinkVideoStatistics | null>(null);

  const [cameraFormat, setCameraFormat] = useState<RealtimeVideoFormat | null>(
    null,
  );
  const [presetMenuVisible, setPresetMenuVisible] = useState(false);
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
        // Bitrate overrides ride on the model's default format; dimensions stay
        // identical to SDK behavior, only the encoder limits change.
        const videoFormat = bitrate
          ? {
              ...realtimeModelSpecifications[model].defaultCameraVideoFormat,
              minimumBitrate: bitrate.minimum,
              maximumBitrate: bitrate.maximum,
            }
          : undefined;
        let stream: RealtimeMediaStream;
        if (externalFileURL) {
          const source = await makeRealtimeFileVideoSource(
            externalFileURL,
            videoFormat ??
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
          stream = fileURL
            ? await realtime.createLocalImageStream(
                videoFormat ? { fileURL, videoFormat } : { fileURL },
              )
            : await realtime.createLocalCameraStream(
                videoFormat ? { videoFormat } : undefined,
              );

        if (alive.current && token === epoch.current) {
          local.current = stream;
          setLocalTrack(stream.videoTrack);
          refreshConfiguration(realtime);
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
    [
      showError,
      nextOperation,
      fileURL,
      externalFileURL,
      model,
      bitrate,
      refreshConfiguration,
    ],
  );

  useEffect(() => {
    if (!entryReady) return;

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
      baseURL: baseURL ?? null,
      loggerOptions: XmaxLoggerOption.all,
    });
    client.current = configuredClient;
    touchReference.current = null;
    const realtime = configuredClient.createRealtimeManager({
      model,
    });

    const generation = new RealtimeGenerationOperations(() =>
      realtime.disconnect(),
    );
    operations.current = generation;
    manager.current = realtime;
    void realtime.setUplinkVideoStatisticsListener(value => {
      if (alive.current && manager.current === realtime) {
        setUplinkStatistics(value);
        refreshConfiguration(realtime);
      }
    });
    void realtime.setDownlinkVideoStatisticsListener(value => {
      if (alive.current && manager.current === realtime) {
        setDownlinkStatistics(value);
        refreshConfiguration(realtime);
      }
    });

    void realtime.setStateListener(value => {
      if (!alive.current || manager.current !== realtime) return;

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
    void teardown.current.then(() => {
      if (
        alive.current &&
        manager.current === realtime &&
        AppState.currentState === 'active'
      )
        return preview(realtime);
    });

    let previous = AppState.currentState;
    let closing: Promise<void> = Promise.resolve();
    const appState = AppState.addEventListener('change', next => {
      if (next === 'background') {
        nextOperation();
        mediaBusy.current = true;
        setBusy(true);
        setGenerationRequested(false);
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
            alive.current &&
            manager.current === realtime &&
            token === epoch.current &&
            AppState.currentState === 'active'
          )
            return preview(realtime);
        });
      }
      if (next !== 'inactive') previous = next;
    });

    // Release on unmount without cancelling and replaying the native back gesture.
    // Invalidate pending work first so late results cannot restore the removed screen.
    return () => {
      alive.current = false;
      nextOperation();
      mediaBusy.current = true;
      operations.current = null;
      client.current = null;
      manager.current = null;
      local.current = null;
      appState.remove();
      void realtime.setStateListener(null);
      teardown.current = generation
        .cancel(() => realtime.close())
        .catch(() => {});
    };
  }, [
    entryReady,
    apiKey,
    environment,
    baseURL,
    model,
    preview,
    refreshConfiguration,
    showError,
    nextOperation,
  ]);

  /**
   * Replaces the generation task and displays its confirmed remote stream.
   */
  const submit = async (
    context: RealtimeContext,
    touchAnimation = false,
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
    if (!context.prompt.trim()) {
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

    setGenerationRequested(true);
    setBusy(true);
    setLoading(true);
    setError(null);

    try {
      await generation.run(async signal => {
        if (touchAnimation && fileURL && !touchReference.current) {
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
        if (touchAnimation)
          context = {
            ...context,
            referencePath: fileURL ? touchReference.current : null,
          };
        if (signal.aborted || token !== epoch.current) return;
        const remote = await realtime.startGeneration({
          localStream: stream,
          context,
          faceRestoration,
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

  /**
   * Disconnects generation while preserving the local media preview.
   */
  const stop = async () => {
    if (!alive.current || !operations.current || mediaBusy.current) return;
    const token = nextOperation();

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

  /** Updates an active task without reconnecting; idle changes apply to the next start. */
  async function changeFaceRestoration(next: boolean) {
    const realtime = manager.current;
    if (busy || !realtime) return;
    const version = ++faceUpdateVersion.current;
    const previous = faceRestoration;
    setFaceRestoration(next);
    if (
      realtime.currentState.connectionState ===
      RealtimeConnectionState.generating
    ) {
      try {
        await operations.current?.run(() =>
          realtime.startGeneration({ faceRestoration: next }),
        );
      } catch (failure) {
        if (
          alive.current &&
          version === faceUpdateVersion.current &&
          XmaxError.from(failure).code !== XmaxErrorCode.cancelled
        ) {
          setFaceRestoration(previous);
          showError(failure);
        }
      }
    }
  }

  /** Updates camera dimensions in place while the preview is ready and disconnected. */
  async function changeCameraFormat(format: RealtimeVideoFormat) {
    const realtime = manager.current;
    if (
      !realtime ||
      busy ||
      mediaBusy.current ||
      realtime.currentState.connectionState !== RealtimeConnectionState.ready
    )
      return;
    const token = nextOperation();
    mediaBusy.current = true;
    setBusy(true);
    setPresetMenuVisible(false);
    try {
      await realtime.updateCameraFormat({
        ...realtime.currentCameraVideoFormat!,
        ...format,
      });
      if (alive.current && token === epoch.current)
        refreshConfiguration(realtime);
    } catch (failure) {
      if (token === epoch.current) showError(failure);
    } finally {
      if (alive.current && token === epoch.current) {
        mediaBusy.current = false;
        setBusy(false);
      }
    }
  }

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('realtime.statistics.title')}
        accessibilityState={{ selected: statisticsVisible }}
        onPress={() => setStatisticsVisible(value => !value)}
        style={[
          styles.statisticsButton,
          {
            top: insets.top + 8,
            right: insets.right + (fileURL || externalFileURL ? 12 : 66),
          },
        ]}
      >
        <Text style={styles.statisticsLabel}>
          {t('realtime.statistics.title')}
        </Text>
      </Pressable>
      {statisticsVisible && (
        <View
          style={[
            styles.statisticsPanel,
            { top: insets.top + 62, right: insets.right + 12 },
          ]}
        >
          <RealtimeStatisticsPanel
            uplink={uplinkStatistics}
            downlink={downlinkStatistics}
            uplinkLevel={uplinkLevel}
            downlinkLevel={downlinkLevel}
            canChange={
              !busy &&
              state.connectionState === RealtimeConnectionState.generating
            }
            onUplinkChange={level => {
              void changeQualityLevel(level, false);
            }}
            onDownlinkChange={level => {
              void changeQualityLevel(level, true);
            }}
          />
        </View>
      )}
      {!fileURL && !externalFileURL && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('realtime.flipCamera')}
          onPress={flip}
          disabled={busy}
          style={({ pressed }) => [
            styles.flip,
            { top: insets.top + 6, right: insets.right + 8 },
            pressed && styles.pressed,
          ]}
        >
          <Image
            source={require('../assets/realtime/realtime_camera_rotate.png')}
            style={styles.flipIcon}
          />
          <Text style={styles.flipLabel}>{t('realtime.flip')}</Text>
        </Pressable>
      )}
      {!fileURL && !externalFileURL && (
        <View
          style={[
            styles.cameraPresetPanel,
            { top: insets.top + 8, left: insets.left + 66 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('realtime.cameraPreset')}
            accessibilityState={{ expanded: presetMenuVisible }}
            disabled={
              busy || state.connectionState !== RealtimeConnectionState.ready
            }
            onPress={() => setPresetMenuVisible(value => !value)}
            style={styles.cameraPresetButton}
          >
            <Text style={styles.statisticsLabel}>
              {cameraFormat
                ? `${cameraFormat.width} × ${cameraFormat.height}`
                : t('realtime.cameraPreset')}
            </Text>
          </Pressable>
          {presetMenuVisible &&
            !busy &&
            state.connectionState === RealtimeConnectionState.ready &&
            realtimeModelSpecifications[model].supportedVideoFormats.map(
              format => (
                <Pressable
                  key={`${format.width}x${format.height}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected:
                      format.width === cameraFormat?.width &&
                      format.height === cameraFormat?.height,
                  }}
                  style={styles.cameraPresetButton}
                  onPress={() => {
                    void changeCameraFormat(format);
                  }}
                >
                  <Text style={styles.statisticsLabel}>
                    {format.width === cameraFormat?.width &&
                    format.height === cameraFormat?.height
                      ? '✓ '
                      : ''}
                    {`${format.width} × ${format.height}`}
                  </Text>
                </Pressable>
              ),
            )}
        </View>
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.bottom,
          { paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <RealtimeControlPanel
          faceRestoration={faceRestoration}
          onFaceRestorationChange={next => {
            void changeFaceRestoration(next);
          }}
          initialCategoryID={fileURL ? 'mox' : 'charx'}
          bottomInset={insets.bottom}
          apiKey={apiKey}
          environment={environment}
          baseURL={baseURL}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={(context, onFailure) => {
            void submit(context, false, onFailure);
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
              true,
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
          error?.permissionError
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
  cameraPresetPanel: {
    position: 'absolute',
    borderRadius: 10,
    backgroundColor: '#000B',
    overflow: 'hidden',
  },
  cameraPresetButton: { paddingHorizontal: 10, paddingVertical: 10 },
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
  flip: {
    position: 'absolute',
    width: 58,
    height: 62,
    paddingTop: 9,
    alignItems: 'center',
  },
  flipIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
    tintColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  flipLabel: {
    marginTop: 5,
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    includeFontPadding: false,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statisticsButton: {
    position: 'absolute',
    padding: 10,
    backgroundColor: '#0007',
    borderRadius: 12,
  },
  statisticsLabel: { color: '#FFF', fontSize: 12 },
  statisticsPanel: { position: 'absolute' },
  pressed: { opacity: 0.7 },
  bottom: { flexShrink: 0 },
});
