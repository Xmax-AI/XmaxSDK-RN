//
//  RealtimeOperationOptions.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import { RealtimeCameraPreset } from '../../Service/Realtime/RealtimeCameraPreset';
import { CameraPosition } from '../../Foundation/Media/Camera/CameraPosition';

/**
 * The cancellation options for an individual SDK operation.
 */
export interface RealtimeOperationOptions {

  /**
   * Cancels this call. Its Promise rejects after the required lifecycle cleanup completes.
   */
  readonly signal?: AbortSignal;
}

/**
 * The capture options for createLocalCameraStream().
 */
export interface CameraStreamOptions extends RealtimeOperationOptions {

  /**
   * The capture format; defaults to the model format of 1024 × 1920 at 30 fps. Dimensions must
   * match a supported model format.
   */
  readonly videoFormat?: RealtimeVideoFormat;

  /**
   * A camera resolution preset using the model-recommended frame rate; cannot be combined with
   * videoFormat.
   */
  readonly preset?: RealtimeCameraPreset;

  /**
   * The camera position; defaults to CameraPosition.front.
   */
  readonly position?: CameraPosition;

  /**
   * Whether to request microphone permission and publish audio when connected; defaults to false.
   */
  readonly useMicrophone?: boolean;
}

/**
 * The options for a local image repeatedly sent as video frames.
 */
export interface ImageStreamOptions extends RealtimeOperationOptions {

  /**
   * A local file URL or absolute path. Android also accepts a readable content URI.
   */
  readonly fileURL: string;

  /**
   * Overrides the frame rate, bitrate, or encoding preference. Dimensions remain subject to the
   * file and model limits. Image input supports 1–60 fps and defaults to the model frame rate, SDK
   * bitrate policy, and maintainFramerate preference.
   */
  readonly videoFormat?: RealtimeVideoFormat | null;
}
