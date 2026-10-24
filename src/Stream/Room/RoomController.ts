//
//  RoomController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { RtcManager } from '../../Foundation/RTC/RtcManager';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionService';
import type {
  RealtimeContext,
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';
import { repeatHeartbeat } from '../../Foundation/Runtime/Async';
import { roomEvent, tracksEvent, type GenerationParameters } from './RoomEvent';
import { cancelledError } from '../../Foundation/Errors/XmaxError';

/**
 * Manages RTC room lifecycle, heartbeat, and generation signaling.
 */
export class RoomController {

  /**
   * The active room connection and server session.
   */
  connection: RealtimeSessionConnection | null = null;

  /**
   * Stops future heartbeats and cancels the in-flight heartbeat request.
   */
  private stopHeartbeat: (() => void) | null = null;

  /**
   * Creates a room controller.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManager,
  ) {}

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
    XmaxLogger.room.info('Joining room');
    await this.rtc.join(
      connection,
      microphone,
      signal
    );
    this.connection = connection;
    XmaxLogger.room.info('Joined room');
    this.stopHeartbeat = repeatHeartbeat(
      async () => {
        await this.rtc.send(
          roomEvent(
            'heartbeat',
            connection.userID,
            this.rtc.runtime
          ),
        );
      },
      () => XmaxLogger.room.warn('Room heartbeat failed'),
    );
  }

  /**
   * Submits encoded messages in order within the room's rate limits.
   *
   * Completes after all packets reach native transport; rejects on cancellation or submission
   * failure.
   *
   * @param event The event type or content to send.
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param context The prompt and reference image location; reusable operations retain the last
   *   successful conditions when omitted.
   * @param options The return dimensions, face restoration, and containment settings. Defaults
   *   preserve the return size, disable face restoration, and omit containment padding.
   */
  send(
    event: 'start' | 'change_condition' | 'change_target_size' | 'stop',
    taskID: string,
    format?: RealtimeVideoFormat,
    context?: RealtimeContext,
    options: GenerationParameters = {},
  ): Promise<void> {
    if (!this.connection) throw cancelledError();

    XmaxLogger.room.debug(
      () =>
        `发送信令 (Send Signal)：${event}\n` +
        `视频 (Video)：${
          format
            ? `${format.width} × ${format.height} @ ${format.fps} fps`
            : 'unchanged'
        }`,
    );
    return this.rtc.send(
      roomEvent(
        event,
        this.connection.userID,
        this.rtc.runtime,
        taskID,
        format,
        context,
        options,
      ),
    );
  }

  /**
   * Submits one interaction sample; recoverable send failures do not end generation.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param points The ordered normalized media coordinates, with x and y from 0 to 1.
   */
  sendTracks(
    taskID: string,
    points: readonly InteractionPoint[],
  ): Promise<void> {
    if (!this.connection) throw cancelledError();
    return this.rtc.send(
      tracksEvent(
        this.connection.userID,
        taskID,
        points,
        this.rtc.runtime
      ),
      true,
    );
  }

  /**
   * Cancels pending messages, detaches result rendering, and leaves the room while retaining local
   * input.
   *
   * Completes after queue cancellation and RTC room exit.
   */
  async leave(): Promise<void> {
    if (this.connection) XmaxLogger.room.info('Leaving room');
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    this.connection = null;
    await this.rtc.leave();
  }
}
