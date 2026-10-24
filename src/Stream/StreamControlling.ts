//
//  StreamControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { QualityControlling } from './Quality/QualityControlling';
import type { EncodingControlling } from './Encoding/EncodingControlling';

import type { RemoteStream } from '../Foundation/RTC/RemoteStream';
import type {
  RealtimeContext,
  RealtimeVideoFormat,
} from '../Service/Realtime/RealtimeTypes';

import type { GenerationParameters } from './Room/RoomEvent';

/**
 * An interface for RTC rooms, generation signaling, encoding, and transport quality.
 */
export interface StreamControlling {

  /**
   * The connection's transport quality policy and history.
   */
  readonly quality: QualityControlling;

  /**
   * The controller that applies video formats to the RTC uplink encoder.
   */
  readonly encoding: EncodingControlling;

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
  beginGeneration(
    taskID: string,
    format: RealtimeVideoFormat,
    context: RealtimeContext,
    signal: AbortSignal,
    options?: GenerationParameters,
  ): Promise<RemoteStream>;

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
    options?: GenerationParameters,
  ): Promise<void>;

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
  ): Promise<void>;

  /**
   * Stops task interactions and sends a stop signal without leaving the room.
   *
   * Discards pending interactions and submits stop; sends nothing after room exit.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   */
  stopGeneration(
    taskID: string
  ): Promise<void>;
}
