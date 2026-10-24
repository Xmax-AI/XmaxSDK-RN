//
//  QualityVideoFormat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeTypes';

/**
 * The dimension scale factors for transport levels 1 through 5.
 */
export const scales = [1, 0.8, 0.65, 0.5, 0.5];
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
 * @returns The transport format resolved from the original baseline and requested level.
 */
export function qualityFormat(
  baseline: RealtimeVideoFormat,
  level: number,
  downlink = false,
): RealtimeVideoFormat {
  const index = Math.max(1, Math.min(5, level)) - 1;
  const shortSide = Math.min(baseline.width, baseline.height);
  const scale = Math.max(scales[index]!, Math.min(shortSide, 240) / shortSide);
  let divisor = baseline.width,
    remainder = baseline.height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const units = Math.floor(Math.floor(divisor * scale + 0.0000001) / 2) * 2;
  return {
    ...baseline,
    width:
      units >= 2
        ? (baseline.width / divisor) * units
        : Math.max(2, Math.floor((baseline.width * scale) / 2) * 2),
    height:
      units >= 2
        ? (baseline.height / divisor) * units
        : Math.max(2, Math.floor((baseline.height * scale) / 2) * 2),
    fps: downlink ? 24 : Math.min(baseline.fps, frameRates[index]!),
    ...(downlink ? { minimumBitrate: null, maximumBitrate: null } : {}),
  };
}
