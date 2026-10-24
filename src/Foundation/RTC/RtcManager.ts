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
import {
  PermissionsAndroid,
  Platform,
  type EventSubscription,
} from 'react-native';
import NativeRuntime from '../Native/NativeXmaxRuntime';
import {
  cancelledError,
  invalid,
  XmaxError,
  XmaxErrorCode,
} from '../Errors/XmaxError';
import { ensureActive, waitFor } from '../Runtime/Async';
import { RtcMessageQueue } from './RtcMessageQueue';
import { RtcStatsLogger } from './RtcStatsLogger';
import { XmaxLogger } from '../Logging/XmaxLogger';
import {
  CameraPosition,
  RealtimeNetworkQualityLevel,
  RealtimePerformanceStatus,
  type RealtimeVideoFormat,
  type RealtimePerformanceAlarm,
  type UplinkVideoStatistics,
  type DownlinkVideoStatistics,
  type VideoContentMode,
} from '../../Service/Realtime/RealtimeTypes';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RuntimeInfo } from '../Runtime/RuntimeInfo';

/**
 * The network quality levels ordered by native quality value.
 */
const qualities = Object.values(RealtimeNetworkQualityLevel);

/**
 * Manages RTC leases, connection waits, and event validity.
 */
export class RtcManager implements RtcManaging {

  /**
   * The ownership identity used to reject retired resource holders.
   */
  private owner: string | null = null;

  /**
   * The shared engine-acquisition task.
   */
  private opening: Promise<void> | null = null;

  /**
   * The shared engine-destruction task for concurrent close calls.
   */
  private closing: Promise<void> | null = null;

  /**
   * The native event subscription removed before media ownership release.
   */
  private nativeEvents: EventSubscription | null = null;

  /**
   * The active room connection and server session.
   */
  private connection: RealtimeSessionConnection | null = null;

  /**
   * The ordered room message queue for this connection.
   */
  private queue: RtcMessageQueue | null = null;

  /**
   * The mapping from native numeric UIDs to public string accounts.
   */
  private accounts = new Map<number, string>();

  /**
   * The latest video publication state for each numeric UID.
   */
  private publications = new Map<number, boolean>();

  /**
   * The latest frame events awaiting string-account mapping.
   */
  private frames = new Map<number, Record<string, unknown>[]>();

  /**
   * The mounted video containers indexed by local or remote stream identity.
   */
  private views = new Map<string, string>();

  /**
   * The scaling mode required by each container binding.
   */
  private modes = new Map<string, VideoContentMode>();

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
  constructor() {
    this.runtime = {
      ...JSON.parse(NativeRuntime.runtimeInfo()),
      sdk_version: '1.0.4',
    };
  }

  /**
   * Creates a UUID for a stream, operation, or media owner.
   */
  randomUUID(): string {
    return NativeRuntime.randomUUID();
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
    return [...this.publications].flatMap(([uid, published]) =>
      published && this.accounts.has(uid) && this.connection
        ? [{ roomID: this.connection.roomID, userID: this.accounts.get(uid)! }]
        : [],
    );
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
    return this.owner !== null && NativeRuntime.isActive(this.owner);
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
    if (!this.owner || !this.active) throw cancelledError();
    await NativeRuntime.rtcCommand(
      this.owner,
      JSON.stringify({ operation, ...params }),
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
    if (!this.owner || !this.active) throw cancelledError();
    return NativeRuntime.rtcCommand(
      this.owner,
      JSON.stringify({ operation: 'readPreference', key }),
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
   * Requests the camera and microphone permissions required by this input.
   *
   * Completes after all required permissions are granted; denial reports the corresponding
   * permission error.
   *
   * @param microphone Whether microphone input is required.
   */
  async permissions(
    microphone: boolean
  ): Promise<void> {
    let result = 'granted';
    if (Platform.OS === 'android') {
      if (
        (await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        )) !== PermissionsAndroid.RESULTS.GRANTED
      )
        result = 'camera';
      else if (
        microphone &&
        (await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        )) !== PermissionsAndroid.RESULTS.GRANTED
      )
        result = 'microphone';
    } else result = await NativeRuntime.requestPermissions(microphone);
    if (result !== 'granted')
      throw new XmaxError({
        code:
          result === 'camera'
            ? XmaxErrorCode.cameraPermissionDenied
            : XmaxErrorCode.microphonePermissionDenied,
        message: `${
          result === 'camera' ? 'Camera' : 'Microphone'
        } permission is required. Enable it in Settings.`,
      });
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
    if (this.owner) {
      if (!this.active) throw cancelledError();
      return;
    }
    if (this.opening || this.closing) throw invalid('RTC engine is busy');
    const owner = this.randomUUID();
    this.opening = (async () => {
      await NativeRuntime.prepareRuntime();
      ensureActive(signal);
      if (!NativeRuntime.acquire(owner))
        throw invalid(
          'Another manager owns the media engine, or the app is in the background',
        );
      this.owner = owner;
      this.nativeEvents = NativeRuntime.onRtcEvent(value => {
        if (this.owner !== owner || !this.active) return;
        try {
          const event = JSON.parse(value);
          if (event.owner === owner) this.receive(event);
        } catch {
          XmaxLogger.rtc.warn('Invalid native RTC event');
        }
      });
      await this.command('open');
      ensureActive(signal);
    })();
    try {
      await this.opening;
    } finally {
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
    this.queue = new RtcMessageQueue(
      packet => this.command(
        'send',
        { message: packet }
      ),
      () => this.randomUUID(),
    );
    await waitFor<void>(
      (resolve, reject) => {
        this.joinListeners.add(resolve);
        const failure = this.onEvent(event => {
          if (event.type === 'error') reject(event.error);
        });
        void this.command(
          'join',
          { ...connection, microphone }
        ).catch(reject);
        return () => {
          this.joinListeners.delete(resolve);
          failure();
        };
      },
      signal,
      20000,
      'RTC room join',
    );
    ensureActive(signal);
    await this.setRemoteAudioVolume(this.audioVolume);
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
    if (!this.queue || !this.active) throw cancelledError();
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
    await this.queue.enqueue(
      message,
      task ? `tracks:${task}` : undefined
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
    this.queue?.drop(`tracks:${taskID}`);
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
    const uid = stream
      ? [...this.accounts].find(([, account]) => account === stream.userID)?.[0]
      : 0;
    const key = stream ? JSON.stringify(stream) : 'local';
    this.views.set(
      key,
      viewID
    );
    this.modes.set(
      key,
      mode
    );
    if (uid === undefined) return Promise.resolve();
    return this.command(
      'bind',
      { viewID, uid, mode }
    );
  }

  /**
   * Detaches a container only while it still belongs to this stream, preserving replacement
   * bindings.
   *
   * @param viewID The unique native identity of the mounted container.
   * @param stream The remote room and account, or null for local input.
   */
  unbind(
    viewID: string,
    stream: RemoteStream | null
  ): void {
    const key = stream ? JSON.stringify(stream) : 'local';
    if (this.views.get(key) !== viewID || !this.active) return;
    this.views.delete(key);
    this.modes.delete(key);
    const uid = stream
      ? [...this.accounts].find(([, account]) => account === stream.userID)?.[0]
      : 0;
    if (uid !== undefined) void this.command(
      'unbind',
      { uid }
    ).catch(() => {});
  }

  /**
   * Cancels pending messages, detaches result rendering, and leaves the room while retaining local
   * input.
   *
   * Completes after queue cancellation and RTC room exit.
   */
  async leave(): Promise<void> {
    this.queue?.close();
    this.queue = null;
    for (const [key] of this.views) {
      if (key === 'local') continue;
      const stream = JSON.parse(key) as RemoteStream;
      const uid = [...this.accounts].find(
        ([, account]) => account === stream.userID,
      )?.[0];
      this.views.delete(key);
      this.modes.delete(key);
      if (uid !== undefined && this.active)
        await this.command(
          'unbind',
          { uid }
        );
    }
    this.connection = null;
    this.accounts.clear();
    this.publications.clear();
    this.frames.clear();
    if (this.active) await this.command('leave');
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
    this.stopLocalCapture();
    const completion = (async () => {
      try {
        await this.opening?.catch(() => {});
        this.queue?.close();
        if (this.active) await this.command('close');
      } finally {
        this.nativeEvents?.remove();
        this.nativeEvents = null;
        if (this.owner) NativeRuntime.release(this.owner);
        this.owner = null;
        this.connection = null;
        this.queue = null;
        this.accounts.clear();
        this.publications.clear();
        this.frames.clear();
        this.views.clear();
        this.modes.clear();
      }
    })();
    this.closing = completion;
    return completion.finally(() => {
      if (this.closing === completion) this.closing = null;
    });
  }

  /**
   * Normalizes current-owner events, deferring account-dependent events until string mapping
   * completes.
   *
   * @param event The event type or content to send.
   */
  private receive(
    event: Record<string, unknown>
  ): void {
    if (event.type === 'joined') {
      if (!this.connection || event.roomID !== this.connection.roomID) return;
      for (const listener of this.joinListeners) listener();
      return;
    }
    if (event.type === 'localFrame' || event.type === 'captureReady') {
      this.emit({ type: event.type });
      return;
    }
    if (event.type === 'error') {
      this.emit({
        type: 'error',
        error: new XmaxError({
          code: XmaxErrorCode.rtcError,
          message: `Agora RTC error (${String(event.code)})`,
        }),
        ...(event.scope === 'all' ? { scope: 'all' as const } : {}),
      });
      return;
    }
    if (!this.connection || event.roomID !== this.connection.roomID) return;
    const uid = Number(event.uid);
    if (event.type === 'account') {
      if (
        !Number.isInteger(uid) ||
        typeof event.userID !== 'string' ||
        !event.userID ||
        this.accounts.get(uid) === event.userID
      )
        return;
      this.accounts.set(
        uid,
        String(event.userID)
      );
      for (const [key, viewID] of this.views) {
        if (key === 'local') continue;
        const stream = JSON.parse(key) as RemoteStream;
        if (stream.userID === event.userID)
          void this.bind(
            viewID,
            stream,
            this.modes.get(key)!
          ).catch(error =>
            this.emit({ type: 'error', error: XmaxError.from(error) }),
          );
      }
      if (this.publications.has(uid))
        this.receive({
          ...event,
          type: 'publication',
          published: this.publications.get(uid),
        });
      for (const frame of this.frames.get(uid) ?? []) this.receive(frame);
      this.frames.delete(uid);
      return;
    }
    if (event.type === 'publication')
      this.publications.set(
        uid,
        event.published === true
      );
    const userID = this.accounts.get(uid);
    if (
      ['publication', 'rendered', 'decoded', 'downlinkStatistics'].includes(
        String(event.type),
      ) &&
      !userID
    ) {
      if (event.type === 'rendered' || event.type === 'decoded')
        this.frames.set(
          uid,
          [
            ...(this.frames.get(uid) ?? []).filter(
              frame => frame.type !== event.type,
            ),
            event,
          ]
        );
      return;
    }
    if (userID && this.connection.botName && userID !== this.connection.botName)
      return;
    if (event.type === 'publication') {
      if (event.published)
        void this.command(
          'subscribe',
          { uid }
        ).catch(error =>
          this.emit({ type: 'error', error: XmaxError.from(error) }),
        );
      this.emit({
        type: 'publication',
        stream: { roomID: this.connection.roomID, userID: userID! },
        published: event.published === true,
      });
    } else if (event.type === 'rendered' || event.type === 'decoded') {
      this.emit({
        type: event.type,
        stream: { roomID: this.connection.roomID, userID: userID! },
        width: Number(event.width),
        height: Number(event.height),
      });
    } else if (event.type === 'quality') {
      this.emit({
        type: 'quality',
        quality: {
          uplink: qualities[Number(event.uplink)] ?? qualities[0]!,
          downlink: qualities[Number(event.downlink)] ?? qualities[0]!,
        },
      });
    } else if (
      event.type === 'uplinkStatistics' ||
      event.type === 'downlinkStatistics'
    ) {
      const statistics: Record<string, unknown> =
        event.type === 'downlinkStatistics' ? { userID } : {};
      const metrics =
        event.type === 'uplinkStatistics'
          ? [
              'width',
              'height',
              'captureFrameRate',
              'encodeFrameRate',
              'sendFrameRate',
              'bitrateKbps',
              'packetLossPercent',
            ]
          : [
              'width',
              'height',
              'decodeFrameRate',
              'renderFrameRate',
              'bitrateKbps',
              'packetLossPercent',
              'endToEndDelayMs',
            ];
      for (const key of metrics) {
        const value = event[key];
        statistics[key] =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          (!['width', 'height'].includes(key) || value > 0) &&
          (key !== 'packetLossPercent' || value <= 100)
            ? value
            : null;
      }
      if (event.type === 'uplinkStatistics') {
        const sample = statistics as unknown as UplinkVideoStatistics;
        RtcStatsLogger.local(sample);
        this.emit({ type: 'uplinkStatistics', statistics: sample });
      } else {
        const sample = statistics as unknown as DownlinkVideoStatistics;
        RtcStatsLogger.remote(sample);
        this.emit({ type: 'downlinkStatistics', statistics: sample });
      }
      if (event.adaptation === 1 || event.adaptation === 2) {
        const width = statistics.width,
          height = statistics.height,
          fps = statistics.encodeFrameRate;
        const alarm: RealtimePerformanceAlarm = {
          status:
            event.adaptation === 2
              ? RealtimePerformanceStatus.limited
              : RealtimePerformanceStatus.recovered,
          suggestedVideoFormat:
            typeof width === 'number' &&
            typeof height === 'number' &&
            typeof fps === 'number' &&
            fps > 0
              ? { width, height, fps }
              : null,
        };
        RtcStatsLogger.alarm(alarm);
        this.emit({ type: 'performance', alarm });
      }
    }
  }
}
