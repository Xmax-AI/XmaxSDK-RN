//
//  XmaxRealtimeManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  cameraPresetSize,
  cameraPresetForSize,
} from '../../Media/Camera/CameraPreset';
import { InteractionController } from '../../Media/Interaction/InteractionController';
import { MediaService } from '../../Service/Media/MediaService';
import { AppState, type NativeEventSubscription } from 'react-native';
import type { XmaxConfiguration } from '../XmaxConfiguration';
import { realtimeAPIBaseURL } from '../XmaxConfiguration';
import { RtcManager } from '../../Foundation/RTC/RtcManager';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import { ensureActive, waitFor } from '../../Foundation/Runtime/Async';
import {
  RealtimeCoordinator,
  type RealtimeOperation,
  type TerminationScope,
} from './RealtimeCoordinator';
import { invalid, XmaxError } from '../../Foundation/Errors/XmaxError';
import { ApiService } from '../../Service/Network/ApiService';
import { RealtimeSessionService } from '../../Service/Realtime/RealtimeSessionService';
import {
  RenderController,
  videoBinding,
  refreshBinding,
} from '../../Render/RenderController';
import { MediaController } from '../../Media/MediaController';
import { RoomController } from '../../Stream/Room/RoomController';
import { StreamController } from '../../Stream/StreamController';
import { XmaxRealtimeConnectionManager } from './XmaxRealtimeConnectionManager';
import { XmaxRealtimeGenerationManager } from './XmaxRealtimeGenerationManager';
import {
  RealtimeConnectionState,
  type RealtimeQualityLevel,
  type RealtimeCameraPreset,
  type RealtimeVideoFormat,
  type CameraStreamOptions,
  type ImageStreamOptions,
  type RealtimeConfiguration,
  type RealtimeContext,
  type RealtimeMediaStream,
  type RealtimeState,
  type RealtimeReason,
  type RealtimeOperationOptions,
} from '../../Service/Realtime/RealtimeTypes';
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
   * The coordinator for realtime operations and lifecycle state.
   */
  private readonly coordinator: RealtimeCoordinator;

  /**
   * The render controller for streams and view bindings.
   */
  private readonly render: RenderController;

  /**
   * The controller that prepares and releases local camera or image input.
   */
  private readonly media: MediaController;

  /**
   * The active room connection and server session.
   */
  private readonly connection: XmaxRealtimeConnectionManager;

  /**
   * The generation task and cached conditions.
   */
  private readonly generation: XmaxRealtimeGenerationManager;

  /**
   * The RTC engine and room adapter for this manager.
   */
  private readonly rtc: RtcManager;

  /**
   * The interaction controller for the current task.
   */
  private readonly interaction: InteractionController;

  /**
   * The controller for signaling, uplink encoding, and downlink quality.
   */
  private readonly stream: StreamController;

  /**
   * The service that resolves media dimensions and model constraints.
   */
  private readonly sizes: MediaService;

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
   * The shared connection cleanup task.
   */
  private disconnectCleanup: Promise<void> | null = null;

  /**
   * Creates a realtime manager with client and model configuration.
   *
   * @param config The validated client configuration.
   * @param options The generation model configuration.
   */
  constructor(
    config: Readonly<Required<XmaxConfiguration>>,
    options: RealtimeConfiguration,
  ) {
    this.options = Object.freeze({ ...options });
    this.rtc = new RtcManager();
    this.sizes = new MediaService(options.model);
    const room = new RoomController(this.rtc);
    this.interaction = new InteractionController((taskID, points) =>
      room.sendTracks(
        taskID,
        points
      ),
    );
    this.coordinator = new RealtimeCoordinator(
      scope => this.cleanup(scope),
      () => this.media.stream !== null,
      () => this.connection.lastSessionID,
      () => this.rtc.stopLocalCapture(),
    );
    this.render = new RenderController(
      this,
      this.rtc,
      this.interaction,
      binding => {
        if (
          binding.valid &&
          binding === videoBinding(this.media.stream?.videoTrack)
        )
          this.coordinator.localPreviewDidBecomeReady();
      },
      (binding, error) => {
        if (binding.valid)
          this.fail(
            error,
            binding.local ? 'all' : 'connection'
          );
      },
    );
    this.media = new MediaController(
      this.rtc,
      this.render,
      options.model
    );

    this.stream = new StreamController(
      this.rtc,
      room
    );

    this.generation = new XmaxRealtimeGenerationManager(
      this.rtc,
      this.stream,
      this.interaction,
    );
    this.connection = new XmaxRealtimeConnectionManager(
      new RealtimeSessionService(
        new ApiService(
          config.apiKey,
          config.baseURL ?? realtimeAPIBaseURL(config.environment),
          this.rtc.runtime,
        ),
      ),
      room,
      this.render,
    );
  }

  /**
   * The immutable connection, session, task, and termination snapshot.
   *
   * @returns The most recent lifecycle snapshot.
   */
  get currentState(): RealtimeState {
    return this.coordinator.currentState;
  }

  /**
   * The resolved camera format, independent of uplink quality changes.
   */
  get currentCameraVideoFormat(): RealtimeVideoFormat | null {
    return this.media.source === 'camera'
      ? this.media.stream?.videoTrack?.videoFormat ?? null
      : null;
  }

  /**
   * The preset matching the camera dimensions.
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
      ? this.stream.quality.uplinkQualityLevel
      : null;
  }

  /**
   * The downlink level successfully submitted for the current connection.
   */
  get downlinkQualityLevel(): RealtimeQualityLevel | null {
    return this.hasConnectedSession
      ? this.stream.quality.downlinkQualityLevel
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
    return this.coordinator.run(
      'media',
      async token => {
        const current = this.currentCameraVideoFormat;
        if (
          this.connection.session ||
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
          await this.media.updateCameraFormat(
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
    return this.coordinator.run(
      'configuration',
      async token => {
        if (
          this.currentState.connectionState !==
            RealtimeConnectionState.generating ||
          !this.generation.taskID
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
    const quality = this.stream.quality;
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
          this.fail(restoreError);
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
    const quality = this.stream.quality;
    if (downlink) {
      const baseline = this.render.requireLocal(this.media.stream!).format;
      const maximum = quality.maximum(level);
      if (!maximum || !this.generation.taskID)
        throw invalid('No active generation');
      await this.generation.changeTargetSize(
        this.sizes.resolveTargetSize(
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
      await this.stream.encoding.configure(format);
    }
  }

  /**
   * The local preview volume; camera and image input do not play local audio, so this is always 0.
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
    this.coordinator.setStateListener(listener);
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
    if (!this.connection.session) this.notify(() => listener?.(null));
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
    if (!this.generation.taskID) this.notify(() => listener?.(null));
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
    await this.rtc.setRemoteAudioVolume(volume);
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
   */
  private update(
    connectionState: RealtimeConnectionState,
    token: RealtimeOperation,
  ): void {
    this.coordinator.commit(
      {
        connectionState,
        sessionID: this.connection.session?.id ?? null,
        taskID:
          connectionState === RealtimeConnectionState.generating
            ? this.generation.taskID
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
      XmaxLogger.realtime.warn('Host listener threw an exception');
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
      this.rtcEvents = this.rtc.onEvent(event => {
        if (event.type === 'decoded' || event.type === 'rendered')
          this.render.updateRemoteFormat(
            event.stream,
            event.width,
            event.height,
          );
        if (event.type === 'quality') {
          this.notify(() => this.qualityListener?.(event.quality));
          void this.adaptQuality(event.quality);
        }
        if (event.type === 'uplinkStatistics' && this.connection.session)
          this.notify(() => this.uplinkStatisticsListener?.(event.statistics));
        if (event.type === 'downlinkStatistics' && this.generation.taskID)
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
          this.fail(
            event.error,
            event.scope ?? 'connection'
          );
      });
  }

  /**
   * Releases affected resources and reports a normalized failure through state.
   *
   * @param error The failure reported by the operation.
   * @param scope The failure cleanup scope; defaults to the connection while preserving local
   *   media.
   */
  private fail(
    error: unknown,
    scope: TerminationScope = 'connection'
  ): void {
    this.interaction.stopInteraction();
    void this.coordinator.terminate(
      scope,
      {
        type: 'failure',
        error: XmaxError.from(error),
      }
    );
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
      token => this.media.createCamera(
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
   * @param options The local image URL, encoding settings, frame rate, and cancellation signal;
   *   dimensions are resolved from the file.
   * @returns The manager-owned image stream after its copy and frame source are prepared.
   */
  createLocalImageStream(
    options: ImageStreamOptions,
  ): Promise<RealtimeMediaStream> {
    return this.createLocal(
      'image',
      token => this.media.createImage(
        options,
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
    source: 'camera' | 'image',
    prepare: (
      token: RealtimeOperation
    ) => Promise<RealtimeMediaStream>,
    signal?: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    return this.coordinator.run(
      'media',
      async token => {
        if (this.connection.session)
          throw invalid('Disconnect before changing the local input');
        if (this.media.source)
          throw invalid(
            'Stop the current local stream before creating another one',
          );
        this.observe();
        this.connection.lastSessionID = null;
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
        if (source === 'image')
          this.update(
            RealtimeConnectionState.ready,
            token
          );
        return stream;
      },
      signal,
    );
  }

  /**
   * Connects this manager's local stream and returns the result stream without starting generation.
   * Bind the result track before waiting for generation.
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
    return this.coordinator.run(
      'connection',
      token => this.connectInternal(
        localStream,
        token
      ),
      signal,
    );
  }

  /**
   * Applies initial transport quality and connects the local stream.
   *
   * @param localStream A local stream created by this manager; streams owned by other managers are
   *   rejected.
   * @param token The operation lease that must remain current at commitment.
   */
  private async connectInternal(
    localStream: RealtimeMediaStream,
    token: RealtimeOperation,
  ): Promise<RealtimeMediaStream> {
    const binding = this.render.requireLocal(localStream);
    if (this.connection.remoteStream) return this.connection.remoteStream;
    token.setFailureScope('connection');
    this.connection.lastSessionID = null;
    this.update(
      RealtimeConnectionState.connecting,
      token
    );
    await this.stream.quality.prepare(
      binding.format,
      this.options.model
    );
    token.ensureCurrent();
    const uplink = this.stream.quality.uplink!;
    await this.stream.encoding.configure(uplink);
    token.ensureCurrent();
    const stream = await this.connection.connect(
      this.options.model,
      binding.format,
      this.media.useMicrophone,
      token.signal,
      error => this.fail(error),
    );
    this.update(
      RealtimeConnectionState.connected,
      token
    );
    return stream;
  }

  /**
   * Starts or updates generation. Initial generation requires conditions; later omitted conditions
   * reuse the last successful values.
   *
   * @param options The local stream, generation conditions, face restoration, and cancellation
   *   settings.
   * @returns The manager-owned result stream after task confirmation.
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
   * reuse the last successful values.
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
   * reuse the last successful values.
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
    return this.coordinator.run(
      'generation',
      async token => {
        const { signal } = token;
        const local = options.localStream ?? this.media.stream;

        if (!local) throw invalid('Create a local media stream first');

        this.render.requireLocal(local);
        if (
          options.faceRestoration !== undefined &&
          typeof options.faceRestoration !== 'boolean'
        )
          throw invalid('faceRestoration must be a boolean');
        this.generation.validateContext(options.context);

        let remoteStream = this.connection.remoteStream;

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
        const format = this.render.requireLocal(local).format;
        const generationFormat = {
          ...format,
          ...this.sizes.resolveGenerationSize(format),
        };
        const remote = await this.generation.start(
          generationFormat,
          options.context,
          signal,
          {
            targetSize: this.sizes.resolveTargetSize(
              format,
              this.stream.quality.targetMaximum ?? format,
            ),
            paddingContain: this.media.source === 'image',
            faceRestoration: options.faceRestoration ?? false,
          },
        );
        this.faceRestoration = options.faceRestoration ?? false;

        ensureActive(signal);
        if (remote && remoteStream.videoTrack) {
          const binding = videoBinding(remoteStream.videoTrack);

          if (binding) {
            binding.remote = remote;
            binding.confirmed = true;
            refreshBinding(binding);
          }
        }

        this.update(
          RealtimeConnectionState.generating,
          token
        );
        if (options.localStream) return remoteStream;
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
    return this.coordinator.run(
      'cameraSwitch',
      async token => {
        const { signal } = token;
        if (this.media.source !== 'camera')
          throw invalid('Create a local camera stream first');
        const generating = this.generation.taskID !== null;
        if (generating) token.setFailureScope('connection');

        if (generating) {
          const binding = videoBinding(
            this.connection.remoteStream?.videoTrack,
          );

          if (binding) {
            binding.confirmed = false;
            refreshBinding(binding);
          }

          await this.generation.stop();
          this.update(
            RealtimeConnectionState.connected,
            token
          );
        }

        const local = await this.media.switchCamera(signal);

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

          const remote = await this.generation.start(
            {
              ...this.render.requireLocal(local).format,
              ...this.sizes.resolveGenerationSize(
                this.render.requireLocal(local).format,
              ),
            },
            null,
            signal,
            {
              targetSize: this.sizes.resolveTargetSize(
                this.render.requireLocal(local).format,
                this.stream.quality.targetMaximum ??
                  this.render.requireLocal(local).format,
              ),
              faceRestoration: this.faceRestoration,
            },
          );
          const track = this.connection.remoteStream?.videoTrack;

          if (remote && track) {
            const binding = videoBinding(track);

            if (binding) {
              binding.remote = remote;
              binding.confirmed = true;
              refreshBinding(binding);
            }
          }

          ensureActive(signal);
          this.update(
            RealtimeConnectionState.generating,
            token
          );
        }

        return local;
      },
      options.signal,
    );
  }

  /**
   * Applies adaptation only when no app operation owns the lifecycle.
   *
   * @param quality The network quality sample for both directions or the selected direction.
   */
  private async adaptQuality(
    quality: import('../../Service/Realtime/RealtimeTypes').RealtimeNetworkQuality,
  ): Promise<void> {
    if (!this.connection.session || this.coordinator.isBusy) {
      this.stream.quality.resetSamples();
      return;
    }
    const change = this.stream.quality.propose(quality);
    if (change.uplink === null && change.downlink === null) return;
    try {
      await this.coordinator.run(
        'configuration',
        async token => {
          for (const downlink of [false, true]) {
            const level = downlink ? change.downlink : change.uplink;
            if (level === null) continue;
            if (downlink && !this.generation.taskID) continue;
            await this.applyQuality(
              level,
              downlink,
              token
            );
          }
        }
      );
    } catch {
      XmaxLogger.stream.warn('Adaptive transport change deferred or failed');
    }
  }

  /**
   * Coalesces connection cleanup when concurrent close calls expand its scope.
   */
  private disconnectInternal(): Promise<void> {
    if (this.disconnectCleanup) return this.disconnectCleanup;
    const cleanup = (async () => {
      await this.render.hideRemote();
      try {
        await this.generation.reset();
      } finally {
        try {
          await this.connection.disconnect();
        } finally {
          this.stream.quality.reset();
          this.notify(() => this.uplinkStatisticsListener?.(null));
          this.notify(() => this.downlinkStatisticsListener?.(null));
        }
      }
    })();
    const completion = cleanup.finally(() => {
      if (this.disconnectCleanup === completion) this.disconnectCleanup = null;
    });
    this.disconnectCleanup = completion;
    return completion;
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
    return this.coordinator.disconnect(options?.reason);
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
   * Stops the specified local input after remote disconnection.
   *
   * @param source The local media source.
   * @param signal The operation's cancellation signal.
   */
  private stopLocal(
    source: 'camera' | 'image',
    signal?: AbortSignal,
  ): Promise<void> {
    return this.coordinator.run(
      'media',
      async token => {
        if (this.connection.session)
          throw invalid('Disconnect before stopping the local input');

        token.setFailureScope('all');
        await this.media.stop(source);
        this.update(
          this.media.stream
            ? RealtimeConnectionState.ready
            : RealtimeConnectionState.idle,
          token,
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
    return this.coordinator.terminate('all');
  }

  /**
   * Waits for active work and releases realtime resources in the requested scope.
   *
   * @param scope Whether to release the connection alone or all local and remote media.
   */
  private async cleanup(
    scope: TerminationScope
  ): Promise<void> {
    if (scope === 'connection') return this.disconnectInternal();
    // Hide remote output before stopping signaling and closing the shared engine.
    let stopFailure: unknown;
    try {
      await this.render.hideRemote();
      await this.generation.reset();
    } catch (error) {
      stopFailure = error;
    }
    try {
      try {
        await this.disconnectInternal();
      } finally {
        await this.media.close();
      }
      if (stopFailure) throw stopFailure;
    } finally {
      this.render.invalidate();
      this.lifecycle?.remove();
      this.lifecycle = null;
      this.rtcEvents?.();
      this.rtcEvents = null;
    }
  }
}
