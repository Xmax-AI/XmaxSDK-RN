//
//  XmaxRealtimeManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeMediaFrameListener } from '../../Service/Realtime/RealtimeMediaFrameListener';
import type { RealtimeExternalVideoSource } from '../../Media/External/RealtimeExternalVideoSource';

import { copyEncodedData } from '../../Foundation/Storage/EncodedData';
import {
  XmaxRealtimeFactory,
  type XmaxRealtimeComponents,
} from './XmaxRealtimeFactory';
import { RealtimeTiming } from '../../Service/Realtime/RealtimeTiming';
import type { XmaxRealtimeErrorManager } from './XmaxRealtimeErrorManager';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { MediaControlling } from '../../Media/MediaControlling';
import type { RenderControlling } from '../../Render/RenderControlling';
import type { StreamControlling } from '../../Stream/StreamControlling';
import type { MediaServicing } from '../../Service/Media/MediaServicing';

import {
  cameraPresetSize,
  cameraPresetForSize,
} from '../../Media/Camera/CameraPreset';

import { AppState, type NativeEventSubscription } from 'react-native';
import type { XmaxConfiguration } from '../XmaxConfiguration';

import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import { ensureActive, waitFor } from '../../Foundation/Runtime/Async';
import type {
  XmaxRealtimeLifecycleManager,
  RealtimeOperation,
} from './XmaxRealtimeLifecycleManager';
import { invalid } from '../../Foundation/Errors/XmaxError';

import type { XmaxRealtimeConnectionManager } from './XmaxRealtimeConnectionManager';
import type { XmaxRealtimeGenerationManager } from './XmaxRealtimeGenerationManager';
import { realtimeModelSpecifications } from '../../Service/Realtime/RealtimeModel';
import {
  RealtimeConnectionState,
  type RealtimeState,
  type RealtimeReason,
} from '../../Service/Realtime/RealtimeState';
import type { RealtimeQualityLevel } from '../../Stream/Quality/RealtimeQualityLevel';
import type { RealtimeCameraPreset } from '../../Service/Realtime/RealtimeCameraPreset';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type {
  CameraStreamOptions,
  ImageStreamOptions,
  RealtimeOperationOptions,
} from './RealtimeOperationOptions';
import type { RealtimeConfiguration } from './RealtimeConfiguration';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type {
  XmaxRealtimeManaging,
  RealtimeStateListener,
  RealtimeNetworkQualityListener,
  RealtimePerformanceAlarmListener,
  UplinkVideoStatisticsListener,
  DownlinkVideoStatisticsListener,
} from './XmaxRealtimeManaging';

/**
 * Implements the public realtime API and sequences media, connection, and generation workflows.
 *
 * Your app accesses this implementation through XmaxRealtimeManaging.
 */
export class XmaxRealtimeManager implements XmaxRealtimeManaging {

  /**
   * The manager's realtime configuration.
   */
  readonly options: Readonly<RealtimeConfiguration>;

  /**
   * The lifecycle owner for operation admission, state, and resource cleanup.
   */
  private readonly lifecycleManager: XmaxRealtimeLifecycleManager;

  /**
   * The shared manager for error normalization and lifecycle failure routing.
   */
  private readonly errorManager: XmaxRealtimeErrorManager;

  /**
   * The shared measurement of generation startup stages.
   */
  private readonly timing: RealtimeTiming;

  /**
   * The render controller for streams and view bindings.
   */
  private readonly renderController: RenderControlling;

  /**
   * The controller that prepares and releases local camera or image input.
   */
  private readonly mediaController: MediaControlling;

  /**
   * The active room connection and server session.
   */
  private readonly connectionManager: XmaxRealtimeConnectionManager;

  /**
   * The generation task and cached conditions.
   */
  private readonly generationManager: XmaxRealtimeGenerationManager;

  /**
   * The RTC engine and room adapter for this manager.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The controller for signaling, uplink encoding, and downlink quality.
   */
  private readonly streamController: StreamControlling;

  /**
   * The service that resolves media dimensions and model constraints.
   */
  private readonly mediaService: MediaServicing;

  /**
   * The uplink video statistics handler.
   */
  private uplinkStatisticsListener: UplinkVideoStatisticsListener | null = null;

  /**
   * The result video statistics handler.
   */
  private downlinkStatisticsListener: DownlinkVideoStatisticsListener | null =
    null;

  /**
   * Whether generation restores the source face.
   */
  private faceRestoration = false;

  /**
   * The uplink and downlink network quality handler.
   */
  private qualityListener: RealtimeNetworkQualityListener | null = null;

  /**
   * The encoder performance limitation and recovery handler.
   */
  private performanceListener: RealtimePerformanceAlarmListener | null = null;

  /**
   * The app lifecycle subscription, removed when media is released.
   */
  private lifecycle: NativeEventSubscription | null = null;

  /**
   * Removes this manager's RTC event subscription.
   */
  private rtcEvents: (() => void) | null = null;

  /**
   * The requested remote playback volume, from 0 to 1.
   */
  private volume = 1;

  /**
   * Creates a realtime manager with client and model configuration.
   *
   * @param config The validated client configuration.
   * @param options The generation model configuration.
   * @param components The assembled dependencies; omission uses the default native components.
   */
  constructor(
    config: Readonly<Required<XmaxConfiguration>>,
    options: RealtimeConfiguration,
    components?: XmaxRealtimeComponents,
  ) {
    this.options = Object.freeze({
      ...options,
      isAdaptiveQualityEnabled: options.isAdaptiveQualityEnabled ?? true,
    });
    const resolved = components ?? XmaxRealtimeFactory.make(
      config,
      options
    );
    this.timing = resolved.timing ?? new RealtimeTiming();
    this.lifecycleManager = resolved.lifecycleManager;
    this.connectionManager = resolved.connectionManager;
    this.generationManager = resolved.generationManager;
    this.errorManager = resolved.errorManager;
    this.mediaController = resolved.mediaController;
    this.renderController = resolved.renderController;
    this.streamController = resolved.streamController;
    this.mediaService = resolved.mediaService;
    this.rtcManager = resolved.rtcManager;
    this.lifecycleManager.setCleanupListener(scope => {
      if (scope === 'connection') {
        this.timing.reset();
        this.notify(() => this.uplinkStatisticsListener?.(null));
        this.notify(() => this.downlinkStatisticsListener?.(null));
      } else if (scope === 'all') {
        this.lifecycle?.remove();
        this.lifecycle = null;
        this.rtcEvents?.();
        this.rtcEvents = null;
      }
    });
  }

  /**
   * The immutable connection, session, task, and termination snapshot.
   *
   * @returns The most recent lifecycle snapshot.
   */
  get currentState(): RealtimeState {
    return this.lifecycleManager.currentState;
  }

  /**
   * The resolved camera format, independent of uplink quality changes.
   */
  get currentCameraVideoFormat(): RealtimeVideoFormat | null {
    return this.mediaController.source === 'camera'
      ? this.mediaController.stream?.videoTrack?.videoFormat ?? null
      : null;
  }

  /**
   * The preset matching the camera dimensions, or null when no preset represents the format.
   */
  get currentCameraPreset(): RealtimeCameraPreset | null {
    const format = this.currentCameraVideoFormat;
    return format ? cameraPresetForSize(format) : null;
  }

  /**
   * The uplink level successfully applied to the current connection.
   */
  get uplinkQualityLevel(): RealtimeQualityLevel | null {
    return this.hasConnectedSession
      ? this.streamController.quality.uplinkQualityLevel
      : null;
  }

  /**
   * The downlink level successfully submitted for the current connection.
   */
  get downlinkQualityLevel(): RealtimeQualityLevel | null {
    return this.hasConnectedSession
      ? this.streamController.quality.downlinkQualityLevel
      : null;
  }

  /**
   * Whether connection state permits reading applied transport levels.
   */
  private get hasConnectedSession(): boolean {
    const state = this.currentState.connectionState;
    return (
      state === RealtimeConnectionState.connected ||
      state === RealtimeConnectionState.generating
    );
  }

  /**
   * Updates a ready camera stream in place; a preset changes dimensions while preserving the track.
   *
   * @param format The complete camera format or resolution preset.
   * @param options The operation's cancellation options.
   */
  updateCameraFormat(
    format: RealtimeVideoFormat | RealtimeCameraPreset,
    options: RealtimeOperationOptions = {},
  ): Promise<void> {
    return this.lifecycleManager.run(
      'media',
      async token => {
        const current = this.currentCameraVideoFormat;
        if (
          this.connectionManager.session ||
          this.currentState.connectionState !== RealtimeConnectionState.ready ||
          !current
        )
          throw invalid(
            'Disconnect realtime and wait for camera preview before updating its format',
          );
        const resolved =
          typeof format === 'string'
            ? { ...current, ...cameraPresetSize(format) }
            : format;
        token.ensureCurrent();
        try {
          await this.mediaController.updateCameraFormat(
            resolved,
            token.signal
          );
        } catch (error) {
          if (!this.currentCameraVideoFormat) token.setFailureScope('all');
          throw error;
        }
        token.ensureCurrent();
      },
      options.signal,
    );
  }

  /**
   * Changes uplink quality during generation without disabling adaptation.
   *
   * @param level The requested uplink quality level.
   * @param options The operation's cancellation options.
   */
  setUplinkQualityLevel(
    level: RealtimeQualityLevel,
    options: RealtimeOperationOptions = {},
  ): Promise<void> {
    return this.setQualityLevel(
      level,
      false,
      options
    );
  }

  /**
   * Submits a downlink quality change; received dimensions may change later.
   *
   * @param level The requested downlink quality level.
   * @param options The operation's cancellation options.
   */
  setDownlinkQualityLevel(
    level: RealtimeQualityLevel,
    options: RealtimeOperationOptions = {},
  ): Promise<void> {
    return this.setQualityLevel(
      level,
      true,
      options
    );
  }

  /**
   * Serializes manual quality changes and rejects invalid levels or inactive generation.
   *
   * @param level The requested transport level, from 1 to 5.
   * @param downlink Whether to change downlink rather than uplink.
   * @param options The operation's cancellation options.
   */
  private setQualityLevel(
    level: RealtimeQualityLevel,
    downlink: boolean,
    options: RealtimeOperationOptions,
  ): Promise<void> {
    return this.lifecycleManager.run(
      'configuration',
      async token => {
        if (
          this.currentState.connectionState !==
            RealtimeConnectionState.generating ||
          !this.generationManager.taskID
        )
          throw invalid('Start generation before setting a quality level');
        if (!Number.isInteger(level) || level < 1 || level > 5)
          throw invalid('Invalid quality level');
        await this.applyQuality(
          level,
          downlink,
          token
        );
      },
      options.signal,
    );
  }

  /**
   * Applies manual and automatic changes through one path, committing history only on success.
   *
   * @param level The requested transport quality level.
   * @param downlink Whether to change downlink rather than uplink.
   * @param token The operation lease that must remain current when committing results.
   */
  private async applyQuality(
    level: RealtimeQualityLevel,
    downlink: boolean,
    token: RealtimeOperation,
  ): Promise<void> {
    const quality = this.streamController.quality;
    const previous = downlink
      ? quality.downlinkQualityLevel
      : quality.uplinkQualityLevel;
    let applied = false;
    try {
      token.ensureCurrent();
      await this.configureQuality(
        level,
        downlink
      );
      applied = true;
      token.ensureCurrent();
      quality.complete(
        level,
        downlink,
        true
      );
    } catch (error) {
      if (
        applied &&
        token.signal.aborted &&
        this.hasConnectedSession &&
        previous !== null
      ) {
        // Restore an acknowledged configuration if cancellation retains the connection.
        try {
          await this.configureQuality(
            previous,
            downlink
          );
        } catch (restoreError) {
          this.errorManager.forward(
            restoreError,
            'connection'
          );
        }
      }
      quality.complete(
        level,
        downlink,
        false
      );
      throw error;
    }
  }

  /**
   * Applies encoding or return parameters without prematurely committing the public level.
   *
   * @param level The requested transport quality level.
   * @param downlink Whether to change downlink rather than uplink.
   */
  private async configureQuality(
    level: RealtimeQualityLevel,
    downlink: boolean,
  ): Promise<void> {
    const quality = this.streamController.quality;
    if (downlink) {
      const baseline = this.renderController.requireLocal(
        this.mediaController.stream!,
      ).format;
      const maximum = quality.maximum(level);
      if (!maximum || !this.generationManager.taskID)
        throw invalid('No active generation');
      await this.generationManager.changeTargetSize(
        this.mediaService.resolveTargetSize(
          baseline,
          maximum
        ),
      );
    } else {
      const format = quality.format(
        level,
        false
      );
      if (!format) throw invalid('No active quality configuration');
      await this.streamController.encoding.configure(format);
    }
  }

  /**
   * The local preview volume; camera, image, and external input do not play local audio, so this is always 0.
   */
  get localAudioVolume(): number {
    return 0;
  }

  /**
   * The result playback volume, from 0 to 1.
   */
  get remoteAudioVolume(): number {
    return this.volume;
  }

  /**
   * Replaces the state listener and immediately delivers the current state; null removes it.
   *
   * Completes after replacing the listener and delivering state; listener exceptions are isolated.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  async setStateListener(
    listener: RealtimeStateListener | null,
  ): Promise<void> {
    this.lifecycleManager.setStateListener(listener);
  }

  /**
   * Sets an app-owned native receiver for the result user's PCM and decoded video.
   *
   * Register before generation or replace while connected. Frames stay on a bounded serial native
   * queue (256 packets, 32 MiB); output loss marks the next packet of that track as discontinuous.
   * Registration does not change audio subscription or playback volume. A callback already running
   * may finish after removal. Retain the native consumer until this listener has been removed.
   * Registration rejects if a bound native receiver is unavailable or observation cannot be configured.
   *
   * @param listener The Swift or Kotlin consumer handle, or null to remove queued output.
   */
  setRemoteMediaFrameListener(
    listener: RealtimeMediaFrameListener | null,
  ): Promise<void> {
    return this.renderController.setRemoteMediaFrameListener(listener);
  }

  /**
   * Sets the network quality listener; null removes it.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  async setNetworkQualityListener(
    listener: RealtimeNetworkQualityListener | null,
  ): Promise<void> {
    this.qualityListener = listener;
  }

  /**
   * Sets the encoder performance listener without changing capture settings; null removes it.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  async setPerformanceAlarmListener(
    listener: RealtimePerformanceAlarmListener | null,
  ): Promise<void> {
    this.performanceListener = listener;
  }

  /**
   * Sets the uplink statistics listener; clearing the stream delivers null.
   *
   * Immediately delivers null when no connection is active.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  async setUplinkVideoStatisticsListener(
    listener: UplinkVideoStatisticsListener | null,
  ): Promise<void> {
    this.uplinkStatisticsListener = listener;
    if (!this.connectionManager.session) this.notify(() => listener?.(null));
  }

  /**
   * Sets the result statistics listener; clearing the result stream delivers null.
   *
   * Immediately delivers null when generation is inactive.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  async setDownlinkVideoStatisticsListener(
    listener: DownlinkVideoStatisticsListener | null,
  ): Promise<void> {
    this.downlinkStatisticsListener = listener;
    if (!this.generationManager.taskID) this.notify(() => listener?.(null));
  }

  /**
   * Validates local volume without enabling camera or image audio playback.
   *
   * Rejects invalid values; valid values do not enable local audio playback.
   *
   * @param volume The playback volume, from 0 for mute to 1 for maximum.
   */
  async setLocalAudioVolume(
    volume: number
  ): Promise<void> {
    this.validateVolume(volume);
  }

  /**
   * Sets result playback volume, from 0 to 1.
   *
   * Completes after applying volume; rejects invalid values or native RTC failures.
   *
   * @param volume The playback volume, from 0 for mute to 1 for maximum.
   */
  async setRemoteAudioVolume(
    volume: number
  ): Promise<void> {
    this.validateVolume(volume);
    await this.rtcManager.setRemoteAudioVolume(volume);
    this.volume = volume;
  }

  /**
   * Rejects nonfinite volume values and values outside 0 to 1.
   *
   * @param value A finite playback volume from 0 to 1.
   */
  private validateVolume(
    value: number
  ): void {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw invalid('Audio volume must be between 0 and 1');
  }

  /**
   * Commits connection state under the active operation lease.
   *
   * @param connectionState The connection state to commit.
   * @param token The operation lease that must remain current at commitment.
   * @param completesOperation Whether to deliver the final state after releasing admission.
   */
  private update(
    connectionState: RealtimeConnectionState,
    token: RealtimeOperation,
    completesOperation = false,
  ): void {
    const commit = completesOperation
      ? this.lifecycleManager.complete.bind(this.lifecycleManager)
      : this.lifecycleManager.commit.bind(this.lifecycleManager);
    commit(
      {
        connectionState,
        sessionID: this.connectionManager.session?.id ?? null,
        taskID:
          connectionState === RealtimeConnectionState.generating
            ? this.generationManager.taskID
            : null,
        reason: null,
      },
      token,
    );
  }

  /**
   * Delivers state without propagating listener exceptions.
   *
   * @param deliver The app callback, whose exceptions are isolated.
   */
  private notify(
    deliver: () => void
  ): void {
    try {
      deliver();
    } catch {
      XmaxLogger.realtime.warn(
        XmaxLogger.localized(
          '应用监听器抛出异常',
          'Host listener threw an exception',
        ),
      );
    }
  }

  /**
   * Registers app lifecycle and RTC listeners for the current resources.
   */
  private observe(): void {
    if (!this.lifecycle)
      this.lifecycle = AppState.addEventListener(
        'change',
        state => {
          if (state === 'background') void this.close();
        }
      );
    if (!this.rtcEvents)
      this.rtcEvents = this.rtcManager.onEvent(event => {
        if (event.type === 'decoded' || event.type === 'rendered')
          this.renderController.updateRemoteFormat(
            event.stream,
            event.width,
            event.height,
          );
        if (event.type === 'localPublished')
          this.timing.finishLocalPublication();
        if (event.type === 'quality') {
          this.notify(() => this.qualityListener?.(event.quality));
          void this.adaptQuality(event.quality);
        }
        if (event.type === 'uplinkStatistics' && this.connectionManager.session)
          this.notify(() => this.uplinkStatisticsListener?.(event.statistics));
        if (
          event.type === 'downlinkStatistics' &&
          this.generationManager.taskID
        )
          this.notify(() =>
            this.downlinkStatisticsListener?.(event.statistics),
          );
        if (event.type === 'performance') {
          this.notify(() => this.performanceListener?.(event.alarm));
        }
        if (
          event.type === 'error' &&
          this.currentState.connectionState !== RealtimeConnectionState.idle &&
          (event.scope === 'all' ||
            this.currentState.connectionState !==
              RealtimeConnectionState.disconnecting)
        )
          this.errorManager.forward(
            event.error,
            event.scope ?? 'connection'
          );
      });
  }

  /**
   * Requests permission and creates a camera stream. Bind its track to complete preview readiness;
   * stop the current input before replacing it.
   *
   * @param options The camera position, format, microphone, and cancellation settings.
   * @returns The manager-owned camera stream; rejects unsupported settings, denied permissions, or
   *   cancellation.
   */
  createLocalCameraStream(
    options: CameraStreamOptions = {},
  ): Promise<RealtimeMediaStream> {
    return this.createLocal(
      'camera',
      token => this.mediaController.createCamera(
        options,
        token.signal
      ),
      options.signal,
    );
  }

  /**
   * Creates an orientation-corrected image copy for continuous frame delivery; your app retains
   * ownership of the original.
   *
   * @param options The image file URL or encoded bytes, encoding settings, frame rate, and
   *   cancellation signal; dimensions are resolved from the encoded image.
   * @returns The manager-owned image stream after its copy and frame source are prepared.
   */
  async createLocalImageStream(
    options: ImageStreamOptions,
  ): Promise<RealtimeMediaStream> {
    if (
      !options ||
      (options.fileURL !== undefined) === (options.imageData !== undefined)
    )
      throw invalid('Supply exactly one image fileURL or imageData source');
    const input: ImageStreamOptions =
      options.imageData !== undefined
        ? { ...options, imageData: copyEncodedData(options.imageData) }
        : { ...options };
    return this.createLocal(
      'image',
      token => this.mediaController.createImage(
        input,
        token.signal
      ),
      options.signal,
    );
  }

  /**
   * Binds an app-owned external video source and optional PCM audio without requesting permissions.
   * Disconnect preserves capture and preview; stopping or closing invalidates the native sink.
   *
   * @param source The source owning native capture or decoding and its stable format.
   * @param options The operation cancellation settings.
   * @returns The local stream after source startup; rejects invalid formats or startup failures.
   */
  createExternalVideoStream(
    source: RealtimeExternalVideoSource,
    options: RealtimeOperationOptions = {},
  ): Promise<RealtimeMediaStream> {
    return this.createLocal(
      'external',
      token => this.mediaController.createExternal(
        source,
        token.signal
      ),
      options.signal,
    );
  }

  /**
   * Creates one local input under exclusive operation ownership and publishes preparation state.
   *
   * @param source The local media source.
   * @param prepare The asynchronous local input preparation operation.
   * @param signal The operation's cancellation signal.
   */
  private createLocal(
    source: 'camera' | 'image' | 'external',
    prepare: (
      token: RealtimeOperation
    ) => Promise<RealtimeMediaStream>,
    signal?: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      'media',
      async token => {
        if (this.connectionManager.session)
          throw invalid('Disconnect before changing the local input');
        if (this.mediaController.source)
          throw invalid(
            'Stop the current local stream before creating another one',
          );
        this.observe();
        this.connectionManager.lastSessionID = null;
        this.update(
          RealtimeConnectionState.preparing,
          token
        );
        token.ensureCurrent();
        const stream = await prepare(token);
        token.setFailureScope('all');
        token.ensureCurrent();
        await this.setRemoteAudioVolume(0);
        token.ensureCurrent();
        if (source !== 'camera')
          this.update(
            RealtimeConnectionState.ready,
            token,
            true
          );
        return stream;
      },
      signal,
    );
  }

  /**
   * Connects this manager's local stream and returns the result stream without starting generation.
   * The result track can be bound before or after generation startup.
   *
   * @param options The local stream and cancellation signal.
   */
  connect(
    {
      localStream,
      signal,
    }: RealtimeOperationOptions & {

      /**
       * An active local stream created by this manager.
       */
      localStream: RealtimeMediaStream;
    }
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      'connection',
      async token => {
        if (this.connectionManager.remoteStream)
          throw invalid('Realtime connection is already open');
        const remote = await this.connectInternal(
          localStream,
          token,
          true
        );
        return remote;
      },
      signal,
    );
  }

  /**
   * Applies initial transport quality and connects the local stream.
   *
   * @param localStream A local stream created by this manager; streams owned by other managers are
   *   rejected.
   * @param token The operation lease that must remain current at commitment.
   * @param completesOperation Whether connection completes the owning operation.
   */
  private async connectInternal(
    localStream: RealtimeMediaStream,
    token: RealtimeOperation,
    completesOperation = false,
  ): Promise<RealtimeMediaStream> {
    const binding = this.renderController.requireLocal(localStream);
    if (this.connectionManager.remoteStream)
      return this.connectionManager.remoteStream;
    token.setFailureScope('connection');
    this.connectionManager.lastSessionID = null;
    this.update(
      RealtimeConnectionState.connecting,
      token
    );
    await this.streamController.quality.prepare(
      binding.format,
      this.options.model,
      realtimeModelSpecifications[this.options.model].minimumInputPixels,
      this.options.isAdaptiveQualityEnabled,
    );
    token.ensureCurrent();
    const uplink = this.streamController.quality.uplink!;
    await this.streamController.encoding.configure(uplink);
    token.ensureCurrent();
    const stream = await this.connectionManager.connect(
      this.options.model,
      binding.format,
      this.mediaController.useMicrophone,
      token.signal,
      error => this.errorManager.forward(
        error,
        'connection'
      ),
    );
    this.update(
      RealtimeConnectionState.connected,
      token,
      completesOperation
    );
    return stream;
  }

  /**
   * Starts or updates generation. Initial generation requires conditions; later omitted conditions
   * reuse the last successful values. A newer call replaces pending generation after required
   * cleanup; replaced calls reject with CANCELLED. Other operation kinds remain exclusive.
   *
   * @param options The local stream, generation conditions, face restoration, and cancellation
   *   settings.
   * @returns The manager-owned result stream after publication, first-frame readiness, and audio
   *   activation.
   */
  startGeneration(
    options: RealtimeOperationOptions & {

      /**
       * An active local stream created by this manager.
       */
      localStream: RealtimeMediaStream;

      /**
       * The generation prompt and reference image location.
       */
      context?: RealtimeContext | null;

      /**
       * Whether generation restores the source face.
       */
      faceRestoration?: boolean;
    },
  ): Promise<RealtimeMediaStream>;

  /**
   * Starts or updates generation. Initial generation requires conditions; later omitted conditions
   * reuse the last successful values. A newer call replaces pending generation after required
   * cleanup; replaced calls reject with CANCELLED. Other operation kinds remain exclusive.
   *
   * @param options The generation conditions, face restoration, and cancellation settings.
   */
  startGeneration(
    options?: RealtimeOperationOptions & {

      /**
       * The generation prompt and reference image location.
       */
      context?: RealtimeContext | null;

      /**
       * Whether generation restores the source face.
       */
      faceRestoration?: boolean;
    },
  ): Promise<void>;

  /**
   * Starts or updates generation. Initial generation requires conditions; later omitted conditions
   * reuse the last successful values. A newer call replaces pending generation after required
   * cleanup; replaced calls reject with CANCELLED. Other operation kinds remain exclusive.
   *
   * @param options The local stream, generation conditions, face restoration, and cancellation
   *   settings.
   * @returns The result stream when localStream is supplied; otherwise completes without returning
   *   a stream.
   */
  startGeneration(
    options: RealtimeOperationOptions & {

      /**
       * An active local stream created by this manager.
       */
      localStream?: RealtimeMediaStream;

      /**
       * The generation prompt and reference image location.
       */
      context?: RealtimeContext | null;

      /**
       * Whether generation restores the source face.
       */
      faceRestoration?: boolean;
    } = {},
  ): Promise<RealtimeMediaStream | void> {
    return this.lifecycleManager.run(
      'generation',
      async token => {
        const { signal } = token;
        const measureStartup =
          this.currentState.connectionState !==
          RealtimeConnectionState.generating;
        if (measureStartup) this.timing.begin();
        try {
          const local = options.localStream ?? this.mediaController.stream;

          if (!local) throw invalid('Create a local media stream first');

          this.renderController.requireLocal(local);
          if (
            options.faceRestoration !== undefined &&
            typeof options.faceRestoration !== 'boolean'
          )
            throw invalid('faceRestoration must be a boolean');
          this.generationManager.validateContext(options.context);

          let remoteStream = this.connectionManager.remoteStream;

          if (!remoteStream) {
            if (!options.localStream)
              throw invalid(
                'Connect before starting generation without a localStream',
              );

            remoteStream = await this.connectInternal(
              local,
              token
            );
          }

          const updating =
            this.currentState.connectionState ===
            RealtimeConnectionState.generating;

          if (!updating) token.setFailureScope('connection');
          const format = this.renderController.requireLocal(local).format;
          const generationFormat = {
            ...format,
            ...this.mediaService.resolveGenerationSize(format),
          };
          const remote = await this.generationManager.start(
            format,
            options.context,
            signal,
            {
              ...(updating
                ? {}
                : {
                    targetSize: this.mediaService.resolveTargetSize(
                      format,
                      this.streamController.quality.targetMaximum ?? format,
                    ),
                  }),
              paddingContain:
                format.width * generationFormat.height !==
                format.height * generationFormat.width,
              faceRestoration: options.faceRestoration ?? false,
            },
            generationFormat,
          );
          this.faceRestoration = options.faceRestoration ?? false;

          ensureActive(signal);
          if (remote && remoteStream.videoTrack)
            await this.renderController.setRemoteStream(
              remoteStream,
              remote
            );

          token.ensureCurrent();
          if (!updating) this.completeInitialQuality();
          this.update(
            RealtimeConnectionState.generating,
            token,
            true
          );
          if (this.generationManager.taskID)
            this.timing.finish(this.generationManager.taskID);
          if (options.localStream) return remoteStream;
        } catch (error) {
          if (measureStartup) this.timing.finishFailure(error);
          throw error;
        }
      },
      options.signal,
    );
  }

  /**
   * Switches cameras while preserving the track; active generation restarts with cached conditions.
   *
   * @param options The operation's cancellation options.
   * @returns The existing camera stream after switching.
   */
  switchCamera(
    options: RealtimeOperationOptions = {},
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      'cameraSwitch',
      async token => {
        const { signal } = token;
        if (this.mediaController.source !== 'camera')
          throw invalid('Create a local camera stream first');
        const generating = this.generationManager.taskID !== null;
        if (generating) token.setFailureScope('connection');

        if (generating) {
          const stream = this.connectionManager.remoteStream;
          if (stream) await this.renderController.setRemoteStream(
            stream,
            null
          );

          await this.generationManager.stop();
          this.update(
            RealtimeConnectionState.connected,
            token
          );
        }

        const local = await this.mediaController.switchCamera(signal);

        ensureActive(signal);
        if (generating) {
          // Wait for capture to stabilize before restarting generation.
          await waitFor<void>(
            resolve => {
              const timer = setTimeout(
                resolve,
                500
              );

              return () => clearTimeout(timer);
            },
            signal,
            1000,
            'Camera switch',
          );

          const remote = await this.generationManager.start(
            this.renderController.requireLocal(local).format,
            null,
            signal,
            {
              targetSize: this.mediaService.resolveTargetSize(
                this.renderController.requireLocal(local).format,
                this.streamController.quality.targetMaximum ??
                  this.renderController.requireLocal(local).format,
              ),
              faceRestoration: this.faceRestoration,
            },
            {
              ...this.renderController.requireLocal(local).format,
              ...this.mediaService.resolveGenerationSize(
                this.renderController.requireLocal(local).format,
              ),
            },
          );
          const stream = this.connectionManager.remoteStream;
          if (remote && stream?.videoTrack)
            await this.renderController.setRemoteStream(
              stream,
              remote
            );

          ensureActive(signal);
          this.completeInitialQuality();
          this.update(
            RealtimeConnectionState.generating,
            token,
            true
          );
        }

        return local;
      },
      options.signal,
    );
  }

  /**
   * Records the applied initial quality and begins stabilization after a new task becomes ready.
   */
  private completeInitialQuality(): void {
    const quality = this.streamController.quality;
    if (quality.uplinkQualityLevel !== null)
      quality.complete(
        quality.uplinkQualityLevel,
        false,
        true
      );
    if (quality.downlinkQualityLevel !== null)
      quality.complete(
        quality.downlinkQualityLevel,
        true,
        true
      );
  }

  /**
   * Applies independent uplink and downlink adaptations only while no app operation owns the
   * lifecycle. Failure in one direction does not prevent adjustment of the other.
   *
   * @param quality The network quality sample for both directions or the selected direction.
   */
  private async adaptQuality(
    quality: import('../../Service/Realtime/RealtimeNetworkQuality').RealtimeNetworkQuality,
  ): Promise<void> {
    if (
      !this.options.isAdaptiveQualityEnabled ||
      this.currentState.connectionState !==
        RealtimeConnectionState.generating ||
      this.lifecycleManager.isBusy
    ) {
      this.streamController.quality.resetSamples();
      return;
    }
    const change = this.streamController.quality.propose(quality);
    if (change.uplink === null && change.downlink === null) return;
    try {
      await this.lifecycleManager.runBackground(async token => {
        for (const downlink of [false, true]) {
          const level = downlink ? change.downlink : change.uplink;
          if (level === null) continue;
          if (downlink && !this.generationManager.taskID) continue;
          token.ensureCurrent();
          try {
            await this.applyQuality(
              level,
              downlink,
              token
            );
          } catch {
            token.ensureCurrent();
            XmaxLogger.stream.warn(
              XmaxLogger.localized(
                '自适应传输调整已延后或失败',
                'Adaptive transport change deferred or failed',
              ),
            );
          }
        }
      });
    } catch {
      XmaxLogger.stream.warn(
        XmaxLogger.localized(
          '自适应传输调整已延后或失败',
          'Adaptive transport change deferred or failed',
        ),
      );
    }
  }

  /**
   * Stops remote generation and closes the room and session while retaining local preview.
   * Concurrent calls share cleanup.
   *
   * @param options The termination reason; defaults to normal disconnection.
   */
  disconnect(
    options?: {

      /**
       * The reason reported in the final state.
       */
      reason?: RealtimeReason;
    }
  ): Promise<void> {
    return this.lifecycleManager.disconnect(options?.reason);
  }

  /**
   * Stops this manager's camera input after disconnection without affecting image input.
   *
   * Completes after camera release; rejects if connected, cancelled, or cleanup fails. Other input
   * types are unchanged.
   *
   * @param options The operation's cancellation options.
   */
  stopLocalCameraStream(
    options: RealtimeOperationOptions = {}
  ): Promise<void> {
    return this.stopLocal(
      'camera',
      options.signal
    );
  }

  /**
   * Stops image frame delivery and removes its private copy after disconnection without affecting
   * camera input.
   *
   * Completes after stopping frames and removing the copy; rejects if connected, cancelled, or
   * cleanup fails. Other input types are unchanged.
   *
   * @param options The operation's cancellation options.
   */
  stopLocalImageStream(
    options: RealtimeOperationOptions = {}
  ): Promise<void> {
    return this.stopLocal(
      'image',
      options.signal
    );
  }

  /**
   * Stops external frame delivery after disconnection without affecting camera or image input.
   * Your app retains ownership of its capture resources.
   *
   * @param options The operation cancellation settings.
   */
  stopExternalVideoStream(
    options: RealtimeOperationOptions = {},
  ): Promise<void> {
    return this.stopLocal(
      'external',
      options.signal
    );
  }

  /**
   * Stops the specified local input after remote disconnection.
   *
   * @param source The local media source.
   * @param signal The operation's cancellation signal.
   */
  private stopLocal(
    source: 'camera' | 'image' | 'external',
    signal?: AbortSignal,
  ): Promise<void> {
    return this.lifecycleManager.run(
      'media',
      async token => {
        if (this.connectionManager.session)
          throw invalid('Disconnect before stopping the local input');

        token.setFailureScope('all');
        await this.mediaController.stop(source);
        this.update(
          this.mediaController.stream
            ? RealtimeConnectionState.ready
            : RealtimeConnectionState.idle,
          token,
          true,
        );
      },
      signal,
    );
  }

  /**
   * Cancels realtime work and releases media, remote tracks, the room, and engine. The manager
   * remains reusable; storage tasks are independent.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  close(): Promise<void> {
    return this.lifecycleManager.terminate('all');
  }
}
