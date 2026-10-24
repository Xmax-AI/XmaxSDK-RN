//
//  MediaControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionControlling } from './Interaction/InteractionControlling';

import type {
  CameraStreamOptions,
  ImageStreamOptions,
} from '../Core/Realtime/RealtimeOperationOptions';
import type { RealtimeMediaStream } from '../Service/Realtime/RealtimeMediaStream';
import type { RealtimeVideoFormat } from '../Service/Realtime/RealtimeVideoFormat';

/**
 * An interface for local media ownership, preparation, and task interactions.
 */
export interface MediaControlling extends InteractionControlling {

  /**
   * The current local input type.
   */
  readonly source: 'camera' | 'image' | null;

  /**
   * The currently held local stream.
   */
  readonly stream: RealtimeMediaStream | null;

  /**
   * Whether the current local input requires microphone audio publication.
   */
  readonly useMicrophone: boolean;

  /**
   * Creates a camera stream after verifying that no other local input is held.
   *
   * @param options The camera position, video format, microphone, and cancellation settings.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The manager-owned local camera stream.
   */
  createCamera(
    options: CameraStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream>;

  /**
   * Creates an image stream after verifying that no other local input is held.
   *
   * @param options The local image URL, encoding settings, frame rate, and cancellation signal;
   *   dimensions are resolved from the file.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The manager-owned local image stream.
   */
  createImage(
    options: ImageStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream>;

  /**
   * Switches the current camera; rejects when the input is an image or no camera is active.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The existing camera stream after switching.
   */
  switchCamera(
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * Updates the current camera format without replacing the media stream.
   *
   * @param format The target camera format.
   * @param signal The operation's cancellation signal.
   */
  updateCameraFormat(
    format: RealtimeVideoFormat,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Releases the current local source only if its input type matches.
   *
   * @param source The local media source.
   */
  stop(
    source: 'camera' | 'image'
  ): Promise<void>;

  /**
   * Releases the current local input and clears its ownership.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  close(): Promise<void>;
}
