//
//  RoomControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';

import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';

import type { GenerationParameters } from './RoomEvent';

/**
 * An interface for RTC room lifecycle, heartbeat, and generation signaling.
 */
export interface RoomControlling {

  /**
   * The active room connection and server session.
   */
  readonly connection: RealtimeSessionConnection | null;

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
  join(
    connection: RealtimeSessionConnection,
    microphone: boolean,
    signal: AbortSignal,
  ): Promise<void>;

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
    options?: GenerationParameters,
  ): Promise<void>;

  /**
   * Submits one interaction sample; recoverable send failures do not end generation.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param points The ordered normalized media coordinates, with x and y from 0 to 1.
   */
  sendTracks(
    taskID: string,
    points: readonly InteractionPoint[],
  ): Promise<void>;

  /**
   * Cancels pending messages, detaches result rendering, and leaves the room while retaining local
   * input.
   *
   * Completes after queue cancellation and RTC room exit.
   */
  leave(): Promise<void>;
}
