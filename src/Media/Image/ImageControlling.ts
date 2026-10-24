//
//  ImageControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  ImageStreamOptions,
  RealtimeMediaStream,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * An interface for image preparation, repeated frame delivery, and cleanup.
 */
export interface ImageControlling {

  /**
   * The currently held local image stream.
   */
  readonly stream: RealtimeMediaStream | null;

  /**
   * Prepares an upright private image copy and starts repeated native frame submission. Copies
   * completed after cancellation are removed.
   *
   * @param options The local image URL, encoding settings, frame rate, and cancellation signal;
   *   dimensions are resolved from the file.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The local image stream after the native frame scheduler is ready.
   */
  create(
    options: ImageStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream>;

  /**
   * Stops native image frame submission, invalidates the local track, and deletes the copy.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  close(): Promise<void>;
}
