//
//  EncodingBitratePolicy.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { invalid } from '../../Foundation/Errors/XmaxError';
import {
  RealtimeVideoEncoderPreference,
  type RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * The pixel-area and bitrate reference points for 15 fps.
 */
const at15: readonly (readonly [number, number])[] = [
  [14400, 50],
  [19200, 65],
  [32400, 100],
  [43200, 120],
  [57600, 140],
  [76800, 200],
  [101760, 220],
  [129600, 260],
  [172800, 320],
  [230400, 400],
  [307200, 500],
  [407040, 610],
  [691200, 910],
  [921600, 1130],
  [2073600, 2080],
];

/**
 * The pixel-area and bitrate reference points for 30 fps.
 */
const at30: readonly (readonly [number, number])[] = [
  [129600, 400],
  [172800, 490],
  [230400, 600],
  [307200, 750],
  [407040, 930],
  [691200, 1380],
  [921600, 1710],
  [2073600, 3150],
];

/**
 * Interpolates between reference points and proportionally extrapolates outside their range.
 *
 * @param value The pixel area or frame rate to evaluate.
 * @param points The bitrate reference points ordered by pixel area or frame rate.
 * @returns The interpolated or extrapolated bitrate reference.
 */
function interpolate(
  value: number,
  points: readonly (readonly [number, number])[],
): number {
  const first = points[0]!;

  if (value <= first[0]) return (first[1] * value) / first[0];

  for (let i = 1; i < points.length; i++) {
    const upper = points[i]!,
      lower = points[i - 1]!;

    if (value <= upper[0])
      return (
        lower[1] +
        ((upper[1] - lower[1]) * (value - lower[0])) / (upper[0] - lower[0])
      );
  }

  const last = points[points.length - 1]!;

  return (last[1] * value) / last[0];
}

/**
 * Validates positive even dimensions and a positive integer frame rate.
 *
 * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
 */
export function validateVideoFormat(
  format: RealtimeVideoFormat
): void {
  if (!format || typeof format !== 'object')
    throw invalid('Video format is required');
  if (
    ![format.width, format.height, format.fps].every(
      n => Number.isSafeInteger(n) && n > 0,
    ) ||
    format.width % 2 ||
    format.height % 2
  )
    throw invalid(
      'Video width and height must be positive even integers; fps must be a positive integer',
    );

  if (
    format.minimumBitrate != null &&
    (!Number.isSafeInteger(format.minimumBitrate) || format.minimumBitrate < 0)
  )
    throw invalid('Minimum bitrate must be a non-negative integer');
  if (
    format.maximumBitrate != null &&
    (!Number.isSafeInteger(format.maximumBitrate) || format.maximumBitrate <= 0)
  )
    throw invalid('Maximum bitrate must be a positive integer');
  if (
    format.minimumBitrate != null &&
    format.maximumBitrate != null &&
    format.minimumBitrate > format.maximumBitrate
  )
    throw invalid('Minimum bitrate must not exceed maximum bitrate');
  if (
    format.encoderPreference !== undefined &&
    !Object.values(RealtimeVideoEncoderPreference).includes(
      format.encoderPreference,
    )
  )
    throw invalid('Invalid video encoder preference');
}

/**
 * Resolves omitted bitrate bounds from policy, preserves explicit values, and validates the final
 * range.
 *
 * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
 * @returns The validated policy bitrate bounds, in kbps.
 */
export function resolveBitrates(
  format: RealtimeVideoFormat
): {

  /**
   * The minimum bitrate, in kbps; 0 leaves the lower bound unrestricted.
   */
  minimum: number;

  /**
   * The maximum encoder bitrate, in kbps.
   */
  maximum: number;
} {
  validateVideoFormat(format);

  const defaults =
    format.minimumBitrate != null && format.maximumBitrate != null
      ? { minimum: format.minimumBitrate, maximum: format.maximumBitrate }
      : defaultBitrates(format);
  const minimum = format.minimumBitrate ?? defaults.minimum;
  const maximum = format.maximumBitrate ?? defaults.maximum;
  if (minimum > maximum)
    throw invalid(
      'Minimum bitrate must not exceed maximum bitrate after applying SDK defaults',
    );

  return { minimum, maximum };
}

/**
 * Interpolates default bitrates from uplink dimensions and frame rate.
 *
 * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
 * @returns The default bitrate bounds for the dimensions and frame rate, in kbps.
 */
function defaultBitrates(
  format: RealtimeVideoFormat
): {

  /**
   * The minimum bitrate, in kbps; 0 leaves the lower bound unrestricted.
   */
  minimum: number;

  /**
   * The maximum encoder bitrate, in kbps.
   */
  maximum: number;
} {
  const pixels = format.width * format.height,
    b15 = interpolate(
      pixels,
      at15
    );
  const b30 =
    pixels < 129600
      ? (b15 * 400) / interpolate(
        129600,
        at15
      )
      : interpolate(
        pixels,
        at30
      );
  const minimum = 100;
  const maximum = Math.max(
    100,
    roundEven(
      0.6 *
        interpolate(
          format.fps,
          [
            [10, b15 * 1.6],
            [15, b15 * 2],
            [30, b30 * 2],
            [60, (b30 * 6500) / 3150],
          ]
        ),
    ),
  );

  if (!Number.isSafeInteger(maximum))
    throw invalid('Video bitrate exceeds the supported range');

  return { minimum, maximum };
}

/**
 * Rounds to the nearest integer, resolving exact half values to the even integer.
 *
 * @param value The finite bitrate value to round.
 */
function roundEven(
  value: number
): number {
  const integer = Math.floor(value);
  return value - integer === 0.5 ? integer + (integer % 2) : Math.round(value);
}
