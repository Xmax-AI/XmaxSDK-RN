//
//  RoomController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeTiming } from '../../Service/Realtime/RealtimeTiming';
import type { RoomControlling } from './RoomControlling';
import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import { repeatHeartbeat } from '../../Foundation/Runtime/Async';
import { roomEvent, tracksEvent, type GenerationParameters } from './RoomEvent';
import { RoomCommandController } from './RoomCommandController';
import { RoomMessageDecoder } from './RoomMessageDecoder';
import { cancelledError } from '../../Foundation/Errors/XmaxError';

/**
 * Manages RTC room lifecycle, heartbeat, and generation signaling.
 */
export class RoomController implements RoomControlling {

  /**
   * The active room connection and server session.
   */
  connection: RealtimeSessionConnection | null = null;

  /**
   * Stops future heartbeats and cancels the in-flight heartbeat request.
   */
  private stopHeartbeat: (() => void) | null = null;

  /**
   * The command scheduler owned by the current joined room lifetime.
   */
  private commands: RoomCommandController | null = null;

  /**
   * The incoming fragment decoder cleared at room exit.
   */
  private readonly decoder = new RoomMessageDecoder();

  /**
   * Removes the current room's receipt and failure subscription.
   */
  private offEvents: (() => void) | null = null;

  /**
   * Creates a room controller.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManaging,

    /**
     * The shared generation startup measurement.
     */
    private readonly timing?: RealtimeTiming,

    /**
     * Whether generation commands use bounded RTC retransmission.
     */
    private readonly retryCommands = true,
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
    XmaxLogger.room.info(XmaxLogger.localized(
      '正在加入房间',
      'Joining room'
    ));
    this.timing?.beginRoomJoin();
    this.timing?.beginLocalPublication();
    await this.rtc.join(
      connection,
      microphone,
      signal
    );
    this.timing?.finishRoomJoin();
    this.connection = connection;
    const commands = new RoomCommandController(
      (message, attemptSignal) => this.rtc.send(
        message,
        false,
        attemptSignal
      ),
      () => this.rtc.randomUUID(),
      this.retryCommands,
    );
    this.commands = commands;
    this.offEvents = this.rtc.onEvent(event => {
      if (this.connection !== connection || this.commands !== commands) return;
      if (event.type === 'error') {
        commands.close();
        this.decoder.reset();
        return;
      }
      if (
        event.type !== 'message' ||
        event.stream.roomID !== connection.roomID ||
        event.stream.userID === connection.userID ||
        (connection.botName && event.stream.userID !== connection.botName)
      )
        return;
      const message = this.decoder.decode(
        event.stream.userID,
        event.message
      );
      if (
        message?.event !== 'xid_ack' ||
        typeof message.xid !== 'string' ||
        typeof message.count !== 'number' ||
        (message.user_id != null && message.user_id !== connection.userID)
      )
        return;
      commands.acknowledge(
        message.xid,
        message.count
      );
    });
    XmaxLogger.room.info(XmaxLogger.localized(
      '已加入房间',
      'Joined room'
    ));
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
      () =>
        XmaxLogger.room.warn(
          XmaxLogger.localized(
            '房间心跳失败',
            'Room heartbeat failed'
          ),
        ),
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
   * @param signal Cancels the unresolved send and its pending redundant attempts.
   */
  send(
    event: 'start' | 'change_condition' | 'change_target_size' | 'stop',
    taskID: string,
    format?: RealtimeVideoFormat,
    context?: RealtimeContext,
    options: GenerationParameters = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const connection = this.connection;
    const commands = this.commands;
    if (!connection || !commands || signal?.aborted) throw cancelledError();
    if (event === 'stop') {
      this.cancelGenerationCommands(taskID);
      this.rtc.discardPendingMessages();
    } else if (event === 'start' || event === 'change_condition') {
      this.rtc.discardPendingMessages(`tracks:${taskID}`);
    }

    XmaxLogger.room.debug(
      () =>
        `${XmaxLogger.localized('发送信令：', 'Send Signal: ')}${event}\n` +
        `${XmaxLogger.localized('视频：', 'Video: ')}${
          format
            ? `${format.width} × ${format.height} @ ${format.fps} fps`
            : XmaxLogger.localized('不变', 'unchanged')
        }`,
    );
    const createMessage = (xid?: string) =>
      roomEvent(
        event,
        connection.userID,
        this.rtc.runtime,
        taskID,
        format,
        context,
        options,
        xid,
      );
    if (event === 'stop') return this.rtc.send(
      createMessage(),
      false,
      signal
    );
    return commands.send(
      event,
      taskID,
      createMessage,
      () => {
        if (this.connection !== connection || this.commands !== commands)
          throw cancelledError();
      },
      signal,
    );
  }

  /**
   * Cancels task commands before media cleanup can suspend.
   *
   * @param taskID The ended task; omission cancels every room command.
   */
  cancelGenerationCommands(
    taskID?: string
  ): void {
    this.commands?.cancel(taskID);
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
    if (this.connection)
      XmaxLogger.room.info(
        XmaxLogger.localized(
          '正在离开房间',
          'Leaving room'
        ),
      );
    this.commands?.close();
    this.commands = null;
    this.offEvents?.();
    this.offEvents = null;
    this.decoder.reset();
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    this.connection = null;
    await this.rtc.leave();
  }
}
