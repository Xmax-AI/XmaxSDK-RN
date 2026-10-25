//
//  RtcManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcManaging } from './RtcManaging';
import type { RemoteStream } from './RemoteStream';
import type { RtcEvent } from './RtcEvent';
import { AgoraRtcPlatform } from './AgoraRtcPlatform';
import type { RtcPlatform, RtcPlatformEvent } from './RtcPlatform';
import type { RtcRoom } from './RtcRoom';
import type { RtcEngineManaging } from './RtcEngineManaging';
import { RtcEngineManager } from './RtcEngineManager';
import type { RtcEngineLease } from './RtcEngineLease';
import {
  cancelledError,
  invalid,
  XmaxError,
  XmaxErrorCode,
} from '../Errors/XmaxError';
import { ensureActive, waitFor } from '../Runtime/Async';
import { CameraPosition } from '../Media/Camera/CameraPosition';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type { VideoContentMode } from '../Media/Video/VideoContentMode';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RuntimeInfo } from '../Runtime/RuntimeInfo';

/**
 * Manages RTC leases, connection waits, and event validity.
 */
export class RtcManager implements RtcManaging {

  /**
   * The exclusive native engine lease retained until media resources are released.
   */
  private lease: RtcEngineLease | null = null;

  /**
   * The shared engine-acquisition task.
   */
  private opening: Promise<void> | null = null;

  /**
   * Cancels pending lease acquisition when the manager closes.
   */
  private acquisition: AbortController | null = null;

  /**
   * The shared engine-destruction task for concurrent close calls.
   */
  private closing: Promise<void> | null = null;

  /**
   * The native event subscription removed before media ownership release.
   */
  private nativeEvents: (() => void) | null = null;

  /**
   * The active room connection and server session.
   */
  private connection: RealtimeSessionConnection | null = null;

  /**
   * The vendor-independent adapter for the active connection.
   */
  private room: RtcRoom | null = null;

  /**
   * The currently bound local video container.
   */
  private localView: string | null = null;

  /**
   * The subscribers to binding or resource changes.
   */
  private listeners = new Set<(
    event: RtcEvent
  ) => void>();

  /**
   * The remote playback volume, from 0 to 1.
   */
  private audioVolume = 0;

  /**
   * The platform, system, device, and SDK version metadata attached to service requests.
   */
  readonly runtime: RuntimeInfo;

  /**
   * Creates a media resource manager and reads runtime metadata without acquiring an engine.
   */
  constructor(
    /**
     * The native engine and room adapter.
     */
    private readonly platform: RtcPlatform = new AgoraRtcPlatform(),

    /**
     * The exclusive process-wide engine lease manager.
     */
    private readonly engines: RtcEngineManaging = RtcEngineManager.shared,
  ) {
    this.runtime = platform.runtime;
  }

  /**
   * Creates a UUID for a stream, operation, or media owner.
   */
  randomUUID(): string {
    return this.platform.randomUUID();
  }

  /**
   * Subscribes to normalized RTC events and returns an unsubscribe function.
   *
   * @param listener The RTC event handler.
   * @returns The idempotent unsubscribe function.
   */
  onEvent(
    listener: (
      event: RtcEvent
    ) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * The remote string accounts currently publishing in the room.
   */
  get publishedStreams(): readonly RemoteStream[] {
    return this.room?.publishedStreams ?? [];
  }

  /**
   * Delivers RTC events to the current media owner's listeners.
   *
   * @param event The event type or content to send.
   */
  private emit(
    event: RtcEvent
  ): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /**
   * Whether this instance retains active foreground media ownership.
   */
  private get active(): boolean {
    return this.lease !== null && this.platform.isActive(this.lease.id);
  }

  /**
   * Executes a validated native RTC command under active media ownership.
   *
   * Completes after native execution; rejects invalid ownership or execution failure.
   *
   * @param operation The operation on the current media resources.
   * @param params The native command parameters; defaults to an empty object.
   */
  private async command(
    operation: string,
    params: object = {}
  ): Promise<void> {
    if (!this.lease || !this.active) throw cancelledError();
    await this.platform.execute(
      this.lease.id,
      operation,
      params
    );
  }

  /**
   * Reads transport quality preferences; this interface does not store credentials.
   *
   * @param key The lookup key for resources, preferences, or message coalescing.
   * @returns The saved JSON, or the string null if no preference exists.
   */
  async readPreference(
    key: string
  ): Promise<string> {
    if (!this.lease || !this.active) throw cancelledError();
    return this.platform.execute(
      this.lease.id,
      'readPreference',
      { key }
    );
  }

  /**
   * Stores transport quality preferences without credentials or user content.
   *
   * @param key The lookup key for resources, preferences, or message coalescing.
   * @param value The serialized quality preference, excluding credentials and user content.
   */
  async writePreference(
    key: string,
    value: string
  ): Promise<void> {
    await this.command(
      'writePreference',
      { key, value }
    );
  }

  /**
   * Acquires exclusive foreground media ownership and initializes native RTC.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  async open(
    signal: AbortSignal
  ): Promise<void> {
    ensureActive(signal);
    if (this.lease) {
      if (!this.active) throw cancelledError();
      return;
    }
    if (this.opening || this.closing) throw invalid('RTC engine is busy');
    const acquisition = new AbortController();
    this.acquisition = acquisition;
    const cancel = () => acquisition.abort();
    signal.addEventListener(
      'abort',
      cancel,
      { once: true }
    );
    if (signal.aborted) acquisition.abort();
    this.opening = (async () => {
      this.lease = await this.engines.acquire(
        this.platform,
        acquisition.signal,
      );
      const lease = this.lease;
      this.nativeEvents = this.platform.onEvent(
        lease.id,
        event => {
          if (this.lease !== lease || !this.active) return;
          this.receive(event);
        }
      );
      await this.command('open');
      ensureActive(acquisition.signal);
    })();
    try {
      await this.opening;
    } catch (error) {
      this.nativeEvents?.();
      this.nativeEvents = null;
      const lease = this.lease as RtcEngineLease | null;
      this.lease = null;
      if (lease) {
        try {
          if (lease.engine.isActive(lease.id))
            await lease.engine.execute(
              lease.id,
              'close'
            );
        } finally {
          this.engines.release(lease);
        }
      }
      throw error;
    } finally {
      signal.removeEventListener(
        'abort',
        cancel
      );
      if (this.acquisition === acquisition) this.acquisition = null;
      this.opening = null;
    }
  }

  /**
   * Starts the selected camera and waits for capture readiness; bind preview after receiving its
   * track.
   *
   * Completes when capture is ready; rejects on startup failure, cancellation, or timeout.
   *
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param position The front or rear camera position.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  async startCamera(
    format: RealtimeVideoFormat,
    position: CameraPosition,
    signal: AbortSignal,
  ): Promise<void> {
    await waitFor<void>(
      (resolve, reject) => {
        const off = this.onEvent(event => {
          if (event.type === 'localFrame' || event.type === 'captureReady')
            resolve();
          else if (event.type === 'error') reject(event.error);
        });
        void this.command(
          'camera',
          {
            ...format,
            front: position === CameraPosition.front,
          }
        ).catch(reject);
        return off;
      },
      signal,
      15000,
      'Camera preview',
    );
  }

  /**
   * Switches cameras through the current engine while preserving the local track.
   *
   * Completes after native switching and mirror configuration.
   *
   * @param position The front or rear camera position.
   */
  async switchCamera(
    position: CameraPosition
  ): Promise<void> {
    await this.command(
      'switchCamera',
      {
        front: position === CameraPosition.front,
      }
    );
  }

  /**
   * Updates disconnected preview capture and encoding in place, restoring the prior native format
   * on failure.
   *
   * @param format The requested camera dimensions, frame rate, and encoder preference.
   * @param minimum The minimum uplink bitrate, in kbps.
   * @param maximum The maximum uplink bitrate, in kbps.
   */
  async updateCameraFormat(
    format: RealtimeVideoFormat,
    minimum: number,
    maximum: number,
  ): Promise<void> {
    if (this.connection)
      throw invalid('Disconnect before updating the camera format');
    await this.command(
      'updateCameraFormat',
      {
        ...format,
        minimum,
        maximum,
        preference: format.encoderPreference ?? 'maintainFramerate',
      }
    );
  }

  /**
   * Selects native external-frame input before joining the room.
   *
   * Completes after external input configuration; rejects unavailable engines or joined rooms.
   */
  async configureImageSource(): Promise<void> {
    if (this.connection) throw invalid('Configure image source before joining');
    await this.command('image');
  }

  /**
   * Creates a native receiver for upright external frames and optional PCM audio.
   *
   * @param sinkID The attachment identity passed to the app's native producer.
   * @param sourceFormat The declared input dimensions and cadence.
   * @param format The processed preview and encoding baseline dimensions.
   * @param hasAudio Whether the source supplies external audio without microphone capture.
   */
  async startExternalSource(
    sinkID: string,
    sourceFormat: RealtimeVideoFormat,
    format: RealtimeVideoFormat,
    hasAudio: boolean,
  ): Promise<void> {
    await this.command(
      'external',
      {
        sinkID,
        sourceWidth: sourceFormat.width,
        sourceHeight: sourceFormat.height,
        ...format,
        hasAudio,
      }
    );
  }

  /**
   * Repeats native image frames at the requested cadence without passing pixels through JS.
   *
   * Completes after native decoding and periodic frame delivery are configured.
   *
   * @param path The absolute path of the SDK-owned image copy.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   */
  async startImage(
    path: string,
    format: RealtimeVideoFormat
  ): Promise<void> {
    await this.command(
      'startImage',
      { path, ...format }
    );
  }

  /**
   * Sets uplink dimensions, frame rate, bitrate, and preference without changing source dimensions.
   *
   * Completes when the native encoder accepts the configuration.
   *
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param minimum The minimum uplink bitrate, in kbps; 0 leaves the minimum unrestricted.
   * @param maximum The positive maximum uplink bitrate, in kbps, not below the minimum.
   */
  async configureEncoding(
    format: RealtimeVideoFormat,
    minimum: number,
    maximum: number,
  ): Promise<void> {
    await this.command(
      'encoding',
      {
        ...format,
        minimum,
        maximum,
        preference: format.encoderPreference ?? 'maintainFramerate',
      }
    );
  }

  /**
   * Joins an authenticated RTC room and creates an ordered data channel.
   *
   * Completes after room join and data-channel creation; rejects on failure, cancellation, or
   * timeout.
   *
   * @param connection The session room, user account, token, and expected result account.
   * @param microphone Whether microphone input is required.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  async join(
    connection: RealtimeSessionConnection,
    microphone: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.connection) throw invalid('Leave the current RTC room first');
    this.connection = connection;
    if (!this.lease || !this.active) throw cancelledError();
    const room = this.platform.createRoom(
      this.lease.id,
      connection
    );
    this.room = room;
    room.setEventListener(event => {
      if (this.room !== room) return;
      if (event.type === 'joined') {
        for (const listener of this.joinListeners) listener();
      } else this.emit(event);
    });
    await waitFor<void>(
      (resolve, reject) => {
        this.joinListeners.add(resolve);
        const failure = this.onEvent(event => {
          if (event.type === 'error') reject(event.error);
        });
        void room.join(microphone).catch(reject);
        return () => {
          this.joinListeners.delete(resolve);
          failure();
        };
      },
      signal,
      15000,
      'RTC room join',
    );
    ensureActive(signal);
    await this.setRemoteAudioVolume(this.audioVolume);
  }

  /**
   * Waits for a new decoded frame from the expected room and account without a mounted view.
   *
   * Completes after a native frame observer sees a valid frame. Cancellation and the ten-second
   * timeout remove the waiter; no pixel data crosses the JavaScript bridge.
   *
   * @param stream The confirmed result stream identity.
   * @param signal The operation cancellation signal.
   */
  async waitUntilRemoteFrameReady(
    stream: RemoteStream,
    signal: AbortSignal,
  ): Promise<void> {
    const connection = this.connection;
    const room = this.room;
    if (!room) throw invalid('Remote RTC room is unavailable');
    const token = this.randomUUID();
    await waitFor<void>(
      (resolve, reject) => {
        const off = this.onEvent(event => {
          if (
            event.type === 'remoteFrameReady' &&
            event.token === token &&
            event.stream.roomID === stream.roomID &&
            event.stream.userID === stream.userID
          )
            resolve();
          else if (event.type === 'error') reject(event.error);
        });
        void room.observeRemoteFrame(
          stream,
          token
        ).catch(reject);
        return () => {
          off();
          if (this.connection === connection && this.room === room)
            void room.clearRemoteFrame(token).catch(() => {});
        };
      },
      signal,
      10000,
      'Remote video first frame',
    );
  }

  /**
   * Changes result audio subscription without changing playback volume.
   *
   * @param stream The result room and account.
   * @param enabled Whether to receive the result account's audio.
   */
  async setRemoteAudioSubscription(
    stream: RemoteStream,
    enabled: boolean,
  ): Promise<void> {
    if (!this.room) throw invalid('Remote RTC room is unavailable');
    await this.room.subscribeRemoteAudio(
      stream,
      enabled
    );
  }

  /**
   * The handlers awaiting room join completion.
   */
  private joinListeners = new Set<() => void>();

  /**
   * Submits encoded messages in order within the room's rate limits.
   *
   * Completes after all packets reach native transport; rejects on cancellation or submission
   * failure.
   *
   * @param message The message content to send.
   * @param interaction Whether this is a coalescible task interaction message; defaults to false.
   */
  async send(
    message: string,
    interaction = false
  ): Promise<void> {
    if (!this.room || !this.active) throw cancelledError();
    const task = interaction
      ? (
          JSON.parse(message) as {

            /**
             * The generation task identifier in the signal.
             */
            uid: string;
          }
        ).uid
      : undefined;
    await this.room.sendRoomMessage(
      message,
      task ? `tracks:${task}` : undefined,
    );
  }

  /**
   * Discards pending task interactions before enqueuing its stop signal.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   */
  discardTracks(
    taskID: string
  ): void {
    this.room?.discardPendingMessages(`tracks:${taskID}`);
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
    this.audioVolume = volume;
    if (this.active)
      await this.command(
        'volume',
        { volume: Math.round(volume * 100) }
      );
  }

  /**
   * Binds a mounted container to local input or a remote account with the requested scaling.
   *
   * Completes after native binding acknowledgment. Unmapped accounts defer binding until mapping
   * arrives.
   *
   * @param viewID The unique native identity of the mounted container.
   * @param stream The remote room and account, or null for local input.
   * @param mode The video fit or fill scaling mode.
   */
  bind(
    viewID: string,
    stream: RemoteStream | null,
    mode: VideoContentMode,
  ): Promise<void> {
    if (stream) {
      if (!this.room)
        return Promise.reject(invalid('Remote RTC room is unavailable'));
      return this.room.bind(
        viewID,
        stream,
        mode
      );
    }
    this.localView = viewID;
    return this.command(
      'bind',
      { viewID, uid: 0, mode }
    );
  }

  /**
   * Detaches only the container still owned by the stream.
   *
   * @param viewID The native mount identity.
   * @param stream The result room and account, or null for local input.
   */
  unbind(
    viewID: string,
    stream: RemoteStream | null
  ): void {
    if (stream) {
      this.room?.unbind(
        viewID,
        stream
      );
      return;
    }
    if (this.localView !== viewID || !this.active) return;
    this.localView = null;
    void this.command(
      'unbind',
      { uid: 0 }
    ).catch(() => {});
  }

  /**
   * Leaves the current room while retaining local capture and rendering.
   */
  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.connection = null;
    if (room) await room.destroy();
  }

  /**
   * Pauses local video and microphone capture without awaiting engine destruction.
   */
  stopLocalCapture(): void {
    if (this.active) void this.command('pause').catch(() => {});
  }

  /**
   * Stops capture, rejects pending messages, and releases the engine and media ownership.
   * Concurrent calls share cleanup.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.acquisition?.abort();
    this.stopLocalCapture();
    const completion = (async () => {
      try {
        await this.opening?.catch(() => {});
        await this.leave().catch(() => {});
        if (this.active) await this.command('close');
      } finally {
        this.nativeEvents?.();
        this.nativeEvents = null;
        const lease = this.lease;
        this.lease = null;
        this.connection = null;
        this.room = null;
        this.localView = null;
        if (lease) this.engines.release(lease);
      }
    })();
    this.closing = completion;
    return completion.finally(() => {
      if (this.closing === completion) this.closing = null;
    });
  }

  /**
   * Routes engine events and delegates room-specific mapping to the room adapter.
   *
   * @param event The scalar event received under current ownership.
   */
  private receive(
    event: RtcPlatformEvent
  ): void {
    if (event.type === 'localFrame' || event.type === 'captureReady') {
      this.emit({ type: event.type });
    } else if (event.type === 'error') {
      this.emit({
        type: 'error',
        error: new XmaxError({
          code:
            event.code === 'MEDIA_ERROR'
              ? XmaxErrorCode.mediaError
              : XmaxErrorCode.rtcError,
          message:
            event.code === 'MEDIA_ERROR'
              ? 'External media source failed'
              : `Agora RTC error (${String(event.code)})`,
        }),
        ...(event.scope === 'all' ? { scope: 'all' as const } : {}),
      });
    } else this.room?.receive(event);
  }
}
