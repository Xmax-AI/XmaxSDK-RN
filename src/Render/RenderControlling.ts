//
//  RenderControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeMediaFrameListener } from '../Service/Realtime/RealtimeMediaFrameListener';
import type { VideoRenderBinding } from './Video/VideoRenderBinding';

import type { RemoteStream } from '../Foundation/RTC/RemoteStream';
import type { CameraPosition } from '../Foundation/Media/Camera/CameraPosition';
import type { RealtimeMediaStream } from '../Service/Realtime/RealtimeMediaStream';
import type { RealtimeVideoFormat } from '../Service/Realtime/RealtimeVideoFormat';

/**
 * An interface for video tracks, render bindings, and result visibility.
 */
export interface RenderControlling {

  /**
   * Sets an app-owned native receiver for the result user's PCM and decoded video.
   *
   * Register before generation or replace while connected. Frames stay on a bounded serial native
   * queue (256 packets, 32 MiB); output loss marks the next packet of that track as discontinuous.
   * Registration does not change audio subscription or playback volume. A callback already running
   * may finish after removal. Retain the native consumer until this listener has been removed.
   * Registration rejects if a bound native receiver is unavailable or observation cannot be configured.
   *
   * @param listener The Swift or Kotlin consumer handle, or null to remove queued output.
   */
  setRemoteMediaFrameListener(
    listener: RealtimeMediaFrameListener | null,
  ): Promise<void>;

  /**
   * Sets the listener notified when the current local preview becomes ready.
   *
   * @param listener The preview readiness handler, or null to remove it.
   */
  setPreviewReadyListener(
    listener: ((
      binding: VideoRenderBinding
    ) => void) | null,
  ): void;

  /**
   * Sets the listener receiving native canvas registration and binding failures.
   *
   * @param listener The binding failure handler, or null to remove it.
   */
  setBindingFailureListener(
    listener: ((
      binding: VideoRenderBinding,
      error: unknown
    ) => void) | null,
  ): void;

  /**
   * Creates a stream and stable track backed by mutable render state.
   *
   * @param local Whether this stream represents local input.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param position The front or rear camera position.
   * @param remote The remote room and account; null denotes local media.
   * @param imageURL The local preview image URL; null selects RTC rendering.
   * @returns The stream and video track owned by this controller.
   */
  create(
    local: boolean,
    format: RealtimeVideoFormat,
    position: CameraPosition | null,
    remote?: RemoteStream | null,
    imageURL?: string | null,
  ): RealtimeMediaStream;

  /**
   * Requires an active local binding owned by this controller.
   *
   * @param stream The manager-owned local media stream.
   * @returns The active owned binding; foreign or invalidated streams throw.
   */
  requireLocal(
    stream: RealtimeMediaStream
  ): VideoRenderBinding;

  /**
   * Updates remote stream confirmation without replacing the public track.
   * Clearing completes after queued native media output has been removed.
   *
   * @param stream The manager-owned result stream.
   * @param remote The confirmed RTC room and account; null hides output while retaining its binding.
   */
  setRemoteStream(
    stream: RealtimeMediaStream,
    remote: RemoteStream | null,
  ): Promise<void>;

  /**
   * Waits for a new decoded result frame without requiring a mounted video view.
   *
   * @param remote The confirmed result room and account.
   * @param signal The generation operation cancellation signal.
   */
  waitUntilRemoteFrameReady(
    remote: RemoteStream,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Updates measured return dimensions while preserving source media and canvas identity.
   *
   * @param stream The remote stream's room and account.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   */
  updateRemoteFormat(
    stream: RemoteStream,
    width: number,
    height: number
  ): void;

  /**
   * Hides native result views before stop signaling or room cleanup to avoid revealing a cleared
   * canvas.
   *
   * Completes after all result views are hidden, before RTC release.
   */
  hideRemote(): Promise<void>;

  /**
   * Invalidates local or remote tracks so released resources cannot be reused.
   *
   * @param local True selects local bindings, false selects remote bindings, and null selects both.
   */
  invalidate(
    local?: boolean | null
  ): void;
}
