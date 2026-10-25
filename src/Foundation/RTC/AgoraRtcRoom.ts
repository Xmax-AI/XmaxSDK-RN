//
//  AgoraRtcRoom.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { cancelledError, invalid, XmaxError } from '../Errors/XmaxError';
import { RtcMessageQueue } from './RtcMessageQueue';
import { RtcStatsLogger } from './RtcStatsLogger';
import { RealtimeNetworkQualityLevel } from '../../Service/Realtime/RealtimeNetworkQuality';
import {
  RealtimePerformanceStatus,
  type RealtimePerformanceAlarm,
} from '../../Service/Realtime/RealtimePerformanceAlarm';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from './VideoStatistics';
import type { VideoContentMode } from '../Media/Video/VideoContentMode';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';

import type { RtcRoom, RtcRoomEvent } from './RtcRoom';
import type { RtcPlatformEvent } from './RtcPlatform';
import type { RemoteStream } from './RemoteStream';
/**
 * The network quality levels ordered by native quality value.
 */
const qualities = Object.values(RealtimeNetworkQualityLevel);

/**
 * Adapts Agora account mapping, subscriptions, rendering, and signaling for one room.
 */
export class AgoraRtcRoom implements RtcRoom {

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
   * The mounted video containers indexed by remote stream identity.
   */
  private views = new Map<string, string>();

  /**
   * The scaling mode required by each container binding.
   */
  private modes = new Map<string, VideoContentMode>();

  /**
   * The room event handler removed before destruction.
   */
  private listener: ((
    event: RtcRoomEvent
  ) => void) | null = null;

  /**
   * Whether this room has been destroyed.
   */
  private closed = false;

  /**
   * The ordered message queue owned by this connection.
   */
  private readonly queue: RtcMessageQueue;

  /**
   * Creates an unjoined room adapter.
   *
   * @param connection The authenticated room and expected result account.
   * @param execute The native executor bound to the owning engine lease.
   * @param uuid The unique message identifier source.
   */
  constructor(
    /**
     * The authenticated room and expected result account.
     */
    private readonly connection: RealtimeSessionConnection,

    /**
     * The native command executor bound to the owning engine lease.
     *
     * @param operation The native room operation.
     * @param parameters The validated scalar operation parameters.
     */
    private readonly execute: (
      operation: string,
      parameters?: object,
    ) => Promise<string>,

    /**
     * The unique message identifier source.
     */
    uuid: () => string,
  ) {
    this.queue = new RtcMessageQueue(
      packet => this.command(
        'send',
        { message: packet }
      ),
      uuid,
    );
  }

  /**
   * Executes an operation only while this room remains live.
   *
   * @param operation The native room operation.
   * @param parameters The validated scalar parameters.
   */
  private async command(
    operation: string,
    parameters: object = {},
  ): Promise<void> {
    if (this.closed) throw cancelledError();
    await this.execute(
      operation,
      parameters
    );
  }

  /**
   * Sets the normalized room event handler.
   *
   * @param listener The current room event handler.
   */
  setEventListener(
    listener: (
      event: RtcRoomEvent
    ) => void
  ): void {
    this.listener = listener;
  }

  /**
   * Delivers a normalized event while the room remains live.
   *
   * @param event The normalized room event.
   */
  private emit(
    event: RtcRoomEvent
  ): void {
    if (!this.closed) this.listener?.(event);
  }

  /**
   * Begins native room admission without waiting for the joined callback.
   *
   * @param microphone Whether to publish microphone input.
   */
  join(
    microphone: boolean
  ): Promise<void> {
    return this.command(
      'join',
      { ...this.connection, microphone }
    );
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
   * Requires a mapped result account belonging to the current RTC room.
   *
   * @param stream The expected result stream identity.
   * @returns The mapped native user identifier.
   */
  private requireRemoteUID(
    stream: RemoteStream
  ): number {
    if (this.connection.roomID !== stream.roomID)
      throw invalid('Remote RTC room is unavailable');
    const entry = [...this.accounts].find(
      ([, account]) => account === stream.userID,
    );
    if (!entry) throw invalid('Remote RTC account is unavailable');
    return entry[0];
  }

  /**
   * Changes result audio subscription after account mapping.
   *
   * @param stream The result room and account.
   * @param enabled Whether to receive the account's audio.
   */
  subscribeRemoteAudio(
    stream: RemoteStream,
    enabled: boolean
  ): Promise<void> {
    return this.command(
      'remoteAudio',
      {
        uid: this.requireRemoteUID(stream),
        enabled,
      }
    );
  }

  /**
   * Arms one decoded-frame observation for the mapped result account.
   *
   * @param stream The result room and account.
   * @param token The observation identity.
   */
  observeRemoteFrame(
    stream: RemoteStream,
    token: string
  ): Promise<void> {
    return this.command(
      'observeRemoteFrame',
      {
        uid: this.requireRemoteUID(stream),
        token,
      }
    );
  }

  /**
   * Clears only the specified observation.
   *
   * @param token The observation identity.
   */
  clearRemoteFrame(
    token: string
  ): Promise<void> {
    return this.command(
      'clearRemoteFrame',
      { token }
    );
  }

  /**
   * Enqueues room signaling in order.
   *
   * @param message The complete JSON message.
   * @param key The optional coalescing key.
   */
  sendRoomMessage(
    message: string,
    key?: string
  ): Promise<void> {
    if (this.closed) return Promise.reject(cancelledError());
    return this.queue.enqueue(
      message,
      key
    );
  }

  /**
   * Discards pending coalescible messages.
   *
   * @param key The message coalescing key.
   */
  discardPendingMessages(
    key: string
  ): void {
    this.queue.drop(key);
  }

  /**
   * Binds a remote account to a mounted container with the requested scaling.
   *
   * Completes after native binding acknowledgment. Unmapped accounts defer binding until mapping
   * arrives.
   *
   * @param viewID The unique native identity of the mounted container.
   * @param stream The result room and account.
   * @param mode The video fit or fill scaling mode.
   */
  bind(
    viewID: string,
    stream: RemoteStream,
    mode: VideoContentMode,
  ): Promise<void> {
    const uid = [...this.accounts].find(
      ([, account]) => account === stream.userID,
    )?.[0];
    const key = JSON.stringify(stream);
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
   * @param stream The result room and account.
   */
  unbind(
    viewID: string,
    stream: RemoteStream
  ): void {
    const key = JSON.stringify(stream);
    if (this.views.get(key) !== viewID || this.closed) return;
    this.views.delete(key);
    this.modes.delete(key);
    const uid = [...this.accounts].find(
      ([, account]) => account === stream.userID,
    )?.[0];
    if (uid !== undefined) void this.command(
      'unbind',
      { uid }
    ).catch(() => {});
  }

  /**
   * Clears account state and queued signaling before leaving the native room.
   */
  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listener = null;
    this.queue.close();
    try {
      for (const key of this.views.keys()) {
        const stream = JSON.parse(key) as RemoteStream;
        const uid = [...this.accounts].find(
          ([, account]) => account === stream.userID,
        )?.[0];
        if (uid !== undefined) await this.execute(
          'unbind',
          { uid }
        );
      }
    } finally {
      this.views.clear();
      this.modes.clear();
      this.accounts.clear();
      this.publications.clear();
      this.frames.clear();
      await this.execute('leave');
    }
  }

  /**
   * Normalizes current-owner events, deferring account-dependent events until string mapping
   * completes.
   *
   * @param event The event type or content to send.
   */
  receive(
    event: RtcPlatformEvent
  ): void {
    if (this.closed) return;
    if (event.type === 'joined') {
      if (event.roomID === this.connection.roomID)
        this.emit({ type: 'joined' });
      return;
    }
    if (event.type === 'localPublished') {
      if (this.connection && event.roomID === this.connection.roomID)
        this.emit({ type: 'localPublished' });
      return;
    }
    if (event.roomID !== this.connection.roomID) return;
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
      [
        'publication',
        'rendered',
        'decoded',
        'remoteFrameReady',
        'downlinkStatistics',
      ].includes(String(event.type)) &&
      !userID
    ) {
      if (
        event.type === 'rendered' ||
        event.type === 'decoded' ||
        event.type === 'remoteFrameReady'
      )
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
    } else if (
      event.type === 'remoteFrameReady' &&
      typeof event.token === 'string'
    ) {
      this.emit({
        type: 'remoteFrameReady',
        stream: { roomID: this.connection.roomID, userID: userID! },
        token: event.token,
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
