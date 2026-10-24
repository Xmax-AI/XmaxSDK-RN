//
//  RoomEvent.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type {
  RealtimeVideoFormat,
  MediaSize,
} from '../../Service/Realtime/RealtimeVideoFormat';
import type { RuntimeInfo } from '../../Foundation/Runtime/RuntimeInfo';
import { resolveBitrates } from '../Encoding/EncodingBitratePolicy';
import { invalid } from '../../Foundation/Errors/XmaxError';

/**
 * Generation options, distinct from aspect-preserving local media dimensions.
 */
export interface GenerationParameters {

  /**
   * The returned dimensions, in pixels; omission retains the current or default target.
   */
  readonly targetSize?: MediaSize;

  /**
   * Whether generation restores the source face.
   */
  readonly faceRestoration?: boolean;

  /**
   * Whether to fit the complete source image within the generation canvas.
   */
  readonly paddingContain?: boolean;
}

/**
 * Serializes generation or heartbeat signaling with task and runtime metadata.
 *
 * @param event The event type or content to send.
 * @param userID The local RTC string account.
 * @param runtime The platform, system, device, and SDK version metadata.
 * @param taskID The generation task identifier; omitted or empty values omit task fields.
 * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
 * @param context The prompt and reference image location; reusable operations retain the last
 *   successful conditions when omitted.
 * @param options The return dimensions, face restoration, and containment settings. Defaults
 *   preserve the target, disable face restoration, and omit containment padding.
 */
export function roomEvent(
  event:
    | 'start'
    | 'change_condition'
    | 'change_target_size'
    | 'stop'
    | 'heartbeat',
  userID: string,
  runtime: RuntimeInfo,
  taskID?: string,
  format?: RealtimeVideoFormat,
  context?: RealtimeContext,
  options: GenerationParameters = {},
): string {
  let params: object | undefined;
  if (event === 'change_target_size' && options.targetSize) {
    params = {
      target_size: [options.targetSize.width, options.targetSize.height],
      ...downlinkBitrates(options.targetSize),
    };
  } else if (format && context) {
    params = {
      model: 'default',
      size: [format.width, format.height],
      prompt: context.prompt,
      ...(context.referencePath
        ? { ref_image_path: context.referencePath }
        : {}),
      ...(options.targetSize
        ? { target_size: [options.targetSize.width, options.targetSize.height] }
        : {}),
      face_replace: options.faceRestoration ?? false,
      ...(options.paddingContain ? { padding: 'contain' } : {}),
      ...(event === 'start'
        ? { mirror: false, ...downlinkBitrates(options.targetSize ?? format) }
        : {}),
    };
  }
  return JSON.stringify({
    event,
    user_id: userID,
    ...(taskID ? { uid: taskID, session_uid: taskID } : {}),
    ...(params ? { params } : {}),
    runtime,
  });
}

/**
 * Resolves downlink bitrate bounds from returned dimensions at 24 fps.
 *
 * @param size The source media dimensions, in pixels.
 * @returns The downlink bitrate bounds, in kbps, resolved at 24 fps.
 */
function downlinkBitrates(
  size: MediaSize
): {

  /**
   * The minimum server output bitrate, in kbps.
   */
  min_bitrate: number;

  /**
   * The maximum server output bitrate, in kbps.
   */
  max_bitrate: number;
} {
  const budget = resolveBitrates({ ...size, fps: 24 });
  return { min_bitrate: 100, max_bitrate: Math.min(10000, budget.maximum) };
}

/**
 * Serializes normalized interaction coordinates for the active task.
 *
 * @param userID The local RTC string account.
 * @param taskID The generation task identifier for signaling and interaction messages.
 * @param points The ordered normalized media coordinates, with x and y from 0 to 1.
 * @param runtime The optional runtime metadata.
 * @returns The interaction JSON containing task identity and normalized coordinates.
 */
export function tracksEvent(
  userID: string,
  taskID: string,
  points: readonly InteractionPoint[],
  runtime?: RuntimeInfo,
): string {
  if (
    points.some(
      point =>
        ![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1),
    )
  )
    throw invalid('Interaction coordinates must be within [0, 1]');
  return JSON.stringify({
    event: 'tracks',
    tracks: points.map(point => [point.x, point.y]),
    user_id: userID,
    uid: taskID,
    session_uid: taskID,
    ...(runtime ? { runtime } : {}),
  });
}
