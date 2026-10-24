//
//  CameraPreset.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { invalid } from '../../Foundation/Errors/XmaxError';
import {
  RealtimeCameraPreset,
  type MediaSize,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * Returns the output dimensions of a camera preset, excluding frame rate and bitrate.
 *
 * @param preset The camera resolution preset.
 */
export function cameraPresetSize(
  preset: RealtimeCameraPreset
): MediaSize {
  if (!Object.values(RealtimeCameraPreset).includes(preset))
    throw invalid('Invalid camera preset');
  const [width, height] = preset.split('x').map(Number);
  return { width: width!, height: height! };
}

/**
 * Matches a camera preset by dimensions, independently of encoding level or frame rate.
 *
 * @param format The current camera media dimensions.
 */
export function cameraPresetForSize(
  format: MediaSize,
): RealtimeCameraPreset | null {
  return (
    Object.values(RealtimeCameraPreset).find(
      preset => preset === `${format.width}x${format.height}`,
    ) ?? null
  );
}
