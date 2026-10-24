//
//  StreamController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RoomControlling } from './Room/RoomControlling';
import type { EncodingControlling } from './Encoding/EncodingControlling';
import type { QualityControlling } from './Quality/QualityControlling';
import type { StreamControlling } from './StreamControlling';

import type { RtcManaging } from '../Foundation/RTC/RtcManaging';
import type { RemoteStream } from '../Foundation/RTC/RemoteStream';
import type {
  RealtimeContext,
  RealtimeVideoFormat,
} from '../Service/Realtime/RealtimeTypes';
import { waitFor } from '../Foundation/Runtime/Async';

import { invalid } from '../Foundation/Errors/XmaxError';
import type { GenerationParameters } from './Room/RoomEvent';

/**
 * Coordinates RTC rooms, media streams, encoding, and quality.
 */
export class StreamController implements StreamControlling {

  /**
   * Creates a signaling and transport configuration controller.
   *
   * @param rtc The RTC manager for encoder configuration and room events.
   * @param room The room controller for connection and generation signaling.
   * @param encoding The controller applying uplink encoding settings.
   * @param quality The controller managing transport quality policies and history.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManaging,

    /**
     * The room controller for connection and signaling.
     */
    readonly room: RoomControlling,

    /**
     * The controller applying uplink encoding settings.
     */
    readonly encoding: EncodingControlling,

    /**
     * The connection's transport quality policy and history.
     */
    readonly quality: QualityControlling,
  ) {}

  /**
   * Submits a start signal and waits for publication by the expected result account and room.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param context The prompt and reference image location; reusable operations retain the last
   *   successful conditions when omitted.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @param options The returned dimensions, face restoration, and input-containment settings.
   * @returns The confirmed remote stream identity after signal submission and expected publication.
   */
  async beginGeneration(
    taskID: string,
    format: RealtimeVideoFormat,
    context: RealtimeContext,
    signal: AbortSignal,
    options: GenerationParameters = {},
  ): Promise<RemoteStream> {
    const connection = this.room.connection;

    if (!connection) throw invalid('Connect before starting generation');

    return waitFor<RemoteStream>(
      (resolve, reject) => {
        let sent = false;
        const confirm = () => {
          if (!sent) return;
          const remote = this.rtc.publishedStreams.find(
            stream =>
              stream.roomID === connection.roomID &&
              (!connection.botName || stream.userID === connection.botName),
          );
          if (remote) resolve(remote);
        };
        const off = this.rtc.onEvent(event => {
          if (event.type === 'error') reject(event.error);
          else if (event.type === 'publication' && event.published) confirm();
        });
        void this.room
          .send(
          'start',
          taskID,
          format,
          context,
          options
        )
          .then(
          () => {
            sent = true;
            confirm();
          },
          reject
        );

        return off;
      },
      signal,
      30000,
      'Generation confirmation',
    );
  }

  /**
   * Updates conditions while retaining the room and task identifier.
   *
   * Completes after native transport accepts the signal; rejects if disconnected or submission
   * fails.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param context The prompt and reference image location; reusable operations retain the last
   *   successful conditions when omitted.
   * @param options The returned dimensions, face restoration, and input-containment settings.
   */
  updateGeneration(
    taskID: string,
    format: RealtimeVideoFormat,
    context: RealtimeContext,
    options: GenerationParameters = {},
  ): Promise<void> {
    return this.room.send(
      'change_condition',
      taskID,
      format,
      context,
      options
    );
  }

  /**
   * Updates only returned dimensions while preserving the room and task.
   *
   * Completes after submitting the size signal; no signal is sent without an active task.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param targetSize The returned frame dimensions, in pixels.
   */
  changeTargetSize(
    taskID: string,
    targetSize: import('../Service/Realtime/RealtimeTypes').MediaSize,
  ): Promise<void> {
    return this.room.send(
      'change_target_size',
      taskID,
      undefined,
      undefined,
      {
        targetSize,
      }
    );
  }

  /**
   * Stops task interactions and sends a stop signal without leaving the room.
   *
   * Discards pending interactions and submits stop; sends nothing after room exit.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   */
  async stopGeneration(
    taskID: string
  ): Promise<void> {
    this.rtc.discardTracks(taskID);
    if (this.room.connection) await this.room.send(
      'stop',
      taskID
    );
  }
}
