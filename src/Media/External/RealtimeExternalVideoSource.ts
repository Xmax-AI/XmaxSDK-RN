//
//  RealtimeExternalVideoSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * An app-owned native capture, decoding, or processing source. Your app manages permissions and
 * capture resources. Lifecycle callbacks run in JavaScript; media buffers remain on native queues.
 */
export interface RealtimeExternalVideoSource {

  /**
   * The upright source dimensions, frame rate, and encoding options; unchanged while attached.
   */
  readonly videoFormat: RealtimeVideoFormat;

  /**
   * Whether the source supplies PCM audio; defaults to false. Submitted audio is not played locally.
   */
  readonly hasAudio?: boolean;

  /**
   * Starts native frame delivery and returns when the source is ready, without waiting for a frame
   * or generation. Pass sink.nativeHandle to your native producer, which resolves the native
   * RealtimeExternalFrameSink and calls pushVideo, pushAudio, or reportError directly.
   * Continue supplying video while disconnected to keep preview active.
   *
   * @param sink The receiver for this attachment; retain it only until stop.
   */
  start(
    sink: RealtimeExternalFrameSink
  ): Promise<void>;

  /**
   * Stops delivery and releases the sink. Must be idempotent, including after partial startup.
   * Your app retains ownership of its capture devices and players.
   */
  stop(): Promise<void>;
}

/**
 * A source attachment connecting JavaScript lifecycle control to a native frame receiver.
 * Native producers resolve nativeHandle through RealtimeExternalFrameSink.find on Swift or Kotlin;
 * pixels and PCM never pass through JavaScript. Handles expire permanently when detached.
 */
export interface RealtimeExternalFrameSink {

  /**
   * The opaque native receiver identity. Do not persist or reuse it across source attachments.
   */
  readonly nativeHandle: string;

  /**
   * The processed preview and quality baseline format. Submit native frames at source dimensions;
   * the native sink copies and resizes them into this model-constrained format.
   */
  readonly videoFormat: Readonly<RealtimeVideoFormat>;

  /**
   * Whether this attachment accepts frames, including while disconnected for local preview.
   */
  readonly isRequestingFrames: boolean;

  /**
   * Reports an unrecoverable source failure and releases generation and local input.
   *
   * @param error The capture, decoding, or processing failure.
   */
  reportError(
    error: unknown
  ): void;
}
