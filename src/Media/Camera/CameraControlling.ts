//
//  CameraControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraStreamOptions } from '../../Core/Realtime/RealtimeOperationOptions';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * An interface for camera capture, format updates, and preview ownership.
 */
export interface CameraControlling {

  /**
   * The currently held local camera stream.
   */
  readonly stream: RealtimeMediaStream | null;

  /**
   * Whether the current camera stream publishes microphone audio.
   */
  readonly useMicrophone: boolean;

  /**
   * Requests camera permission, configures encoding, and starts capture. The returned track is
   * owned by this controller.
   *
   * @param options The camera position, video format, microphone, and cancellation settings.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The camera stream after capture starts; its track must then be mounted to bind the
   *   preview.
   */
  create(
    options: CameraStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream>;

  /**
   * Switches the camera position and updates the existing local track binding.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The original local stream with its camera position updated.
   */
  switch(
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * Updates camera capture and encoding in place while preserving the stream, track, and preview
   * binding.
   *
   * @param requested The target media format; dimensions must match a format supported by the
   *   model.
   * @param signal The operation's cancellation signal.
   */
  updateVideoFormat(
    requested: RealtimeVideoFormat,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Invalidates the camera track and releases native camera and RTC resources.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  close(): Promise<void>;
}
