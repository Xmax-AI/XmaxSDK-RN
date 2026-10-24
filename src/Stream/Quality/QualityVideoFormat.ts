//
//  QualityVideoFormat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * The dimension scale factors for transport levels 1 through 5.
 */
export const scales = [1, 0.9, 0.75, 0.6, 0.5];

/**
 * The uplink frame-rate limits for transport levels 1 through 5.
 */
const frameRates = [30, 24, 24, 20, 16];

/**
 * Resolves transport levels without changing capture or generation dimensions.
 *
 * @param baseline The original media format used as the transport baseline.
 * @param level The transport level, from 1 for highest quality to 5 for lowest.
 * @param downlink Whether to resolve downlink rather than the default uplink policy.
 * @param minimumInputPixels The minimum uplink pixel area, capped at the baseline area; ignored
 *   for downlink.
 * @returns The transport format resolved from the original baseline and requested level.
 */
export function qualityFormat(
  baseline: RealtimeVideoFormat,
  level: number,
  downlink = false,
  minimumInputPixels = 0,
): RealtimeVideoFormat {
  const index = Math.max(1, Math.min(5, level)) - 1;
  const shortSide = Math.min(baseline.width, baseline.height);
  const scale = Math.max(scales[index]!, Math.min(shortSide, 240) / shortSide);
  let divisor = baseline.width,
    remainder = baseline.height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const alignment = downlink ? 2 : 4;
  const pixels = baseline.width * baseline.height;
  const minimumScale = Math.sqrt(
    Math.min(downlink ? 0 : Math.max(0, minimumInputPixels), pixels) / pixels,
  );
  const minimumUnits =
    Math.ceil((divisor * minimumScale) / alignment) * alignment;
  const units =
    Math.floor(Math.floor(divisor * scale + 0.0000001) / alignment) * alignment;
  const resolvedUnits = Math.max(units, minimumUnits);
  const exact = units >= alignment && resolvedUnits <= divisor;
  return {
    ...baseline,
    width: exact
      ? (baseline.width / divisor) * resolvedUnits
      : Math.max(
          alignment,
          Math.floor((baseline.width * scale) / alignment) * alignment,
          Math.ceil((baseline.width * minimumScale) / alignment) * alignment,
        ),
    height: exact
      ? (baseline.height / divisor) * resolvedUnits
      : Math.max(
          alignment,
          Math.floor((baseline.height * scale) / alignment) * alignment,
          Math.ceil((baseline.height * minimumScale) / alignment) * alignment,
        ),
    fps: downlink ? 24 : Math.min(baseline.fps, frameRates[index]!),
    ...(downlink ? { minimumBitrate: null, maximumBitrate: null } : {}),
  };
}
