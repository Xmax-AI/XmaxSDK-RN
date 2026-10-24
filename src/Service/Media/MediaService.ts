//
//  MediaService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaServicing } from './MediaServicing';
import { invalid } from '../../Foundation/Errors/XmaxError';
import { RealtimeMediaSource } from './RealtimeMediaSource';
import {
  RealtimeModel,
  realtimeModelSpecifications,
} from '../Realtime/RealtimeModel';
import type { MediaSize } from '../Realtime/RealtimeVideoFormat';

/**
 * The sizing and capability rules for local media, generation canvases, and returned media.
 */
export class MediaService implements MediaServicing {

  /**
   * Creates a sizing service for the specified model without allocating media resources.
   */
  constructor(
    /**
     * The generation model used for sizing; defaults to x2.1.1-preview-cn.
     */
    readonly model: RealtimeModel = RealtimeModel.x2_1_1_preview_cn,
  ) {}

  /**
   * Resolves local media dimensions within the model area limits, upscaling or downscaling as
   * needed. Camera dimensions must match a supported model format.
   *
   * @param size The source media dimensions, in pixels.
   * @param source The camera or image input type. Camera dimensions must match a supported model
   *   format.
   */
  resolveMediaSize(
    size: MediaSize,
    source: RealtimeMediaSource
  ): MediaSize {
    validateSize(size);
    const spec = realtimeModelSpecifications[this.model];
    if (
      source === RealtimeMediaSource.camera &&
      spec.supportedVideoFormats.length > 0 &&
      !spec.supportedVideoFormats.some(
        bucket => bucket.width === size.width && bucket.height === size.height,
      )
    )
      throw invalid('Camera dimensions must match a model resolution bucket');

    const pixels = size.width * size.height;
    const targetPixels = Math.min(
      spec.maximumInputPixels,
      Math.max(spec.minimumInputPixels, pixels),
    );
    const scale = Math.sqrt(targetPixels / pixels);
    return alignedSize(
      size,
      scale,
      4,
      {
        minimum: spec.minimumInputPixels,
        maximum: spec.maximumInputPixels,
      }
    );
  }

  /**
   * Selects the model canvas closest to the source aspect ratio without changing the local image.
   *
   * @param size The source media dimensions, in pixels.
   */
  resolveGenerationSize(
    size: MediaSize
  ): MediaSize {
    if (
      ![size.width, size.height].every(
        value =>
          Number.isFinite(value) &&
          value > 0 &&
          value < Number.MAX_SAFE_INTEGER,
      )
    )
      throw invalid('Media dimensions must be positive and finite');
    const spec = realtimeModelSpecifications[this.model];
    const buckets = spec.supportedVideoFormats;
    if (!buckets.length) {
      const source = {
        width: Math.max(1, Math.round(size.width)),
        height: Math.max(1, Math.round(size.height)),
      };
      const pixels = source.width * source.height;
      const scale = Math.sqrt(
        Math.min(
          spec.maximumInputPixels,
          Math.max(spec.minimumInputPixels, pixels),
        ) / pixels,
      );
      const rounding =
        pixels < spec.minimumInputPixels
          ? Math.ceil
          : pixels > spec.maximumInputPixels
          ? Math.floor
          : Math.round;
      const alignment = spec.inputSizeAlignment;
      const width = Math.max(
        alignment,
        rounding((source.width * scale) / alignment) * alignment,
      );
      const height = Math.max(
        alignment,
        rounding((source.height * scale) / alignment) * alignment,
      );
      if (
        width * height >= spec.minimumInputPixels &&
        width * height <= spec.maximumInputPixels
      )
        return { width, height };
      return boundedAlignedSize(
        { width: source.width * scale, height: source.height * scale },
        alignment,
        { minimum: spec.minimumInputPixels, maximum: spec.maximumInputPixels },
      );
    }
    const aspect = size.width / size.height;
    const selected = buckets.reduce((best, next) =>
      Math.abs(Math.log(aspect / (next.width / next.height))) <
      Math.abs(Math.log(aspect / (best.width / best.height)))
        ? next
        : best,
    );
    return { width: selected.width, height: selected.height };
  }

  /**
   * Downscales proportionally within the returned media bounds, preserving the exact aspect ratio
   * when 4-pixel alignment permits.
   *
   * @param size The source media dimensions, in pixels.
   * @param maximumSize The positive upper bounds for returned media dimensions. Output cannot
   *   exceed the source dimensions.
   * @returns The aspect-preserving dimensions aligned to 4 pixels, constrained by both the source
   *   dimensions and target bounds.
   */
  resolveTargetSize(
    size: MediaSize,
    maximumSize: MediaSize
  ): MediaSize {
    validateSize(size);
    if (
      ![maximumSize.width, maximumSize.height].every(
        n => Number.isFinite(n) && n > 0,
      )
    )
      throw invalid('Target bounds must be positive and finite');
    return alignedSize(
      size,
      Math.min(
        1,
        maximumSize.width / size.width,
        maximumSize.height / size.height,
      ),
      4,
    );
  }
}

/**
 * Validates integer dimensions consistently for native media and target sizing.
 *
 * @param size The source media dimensions, in pixels.
 */
function validateSize(
  size: MediaSize
): void {
  if (![size.width, size.height].every(n => Number.isSafeInteger(n) && n > 0))
    throw invalid('Media dimensions must be positive integers');
}

/**
 * The inclusive pixel area limits for aligned local media.
 */
interface PixelLimits {

  /**
   * The minimum pixel area.
   */
  readonly minimum: number;

  /**
   * The maximum pixel area.
   */
  readonly maximum: number;
}

/**
 * Resolves aligned dimensions at a uniform scale, preferring exact aspect ratio.
 *
 * @param size The positive integer source dimensions, in pixels.
 * @param scale The uniform dimension scale.
 * @param alignment The required dimension multiple, in pixels.
 * @param pixelLimits The optional inclusive area bounds; omitted bounds only round down.
 * @returns Aligned dimensions within the area bounds or requested scale.
 * @throws A configuration error if the scale cannot fit one alignment unit.
 */
export function alignedSize(
  size: MediaSize,
  scale: number,
  alignment: number,
  pixelLimits?: PixelLimits,
): MediaSize {
  let divisor = size.width;
  let remainder = size.height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];

  const ratioWidth = size.width / divisor;
  const ratioHeight = size.height / divisor;
  let units = Math.floor((divisor * scale) / alignment) * alignment;
  if (pixelLimits) {
    const minimumScale = Math.sqrt(
      pixelLimits.minimum / (ratioWidth * ratioHeight),
    );
    units = Math.max(units, Math.ceil(minimumScale / alignment) * alignment);
  }
  const exactWidth = ratioWidth * units;
  const exactHeight = ratioHeight * units;
  if (
    units >= alignment &&
    exactWidth * exactHeight <= (pixelLimits?.maximum ?? Infinity)
  )
    return { width: exactWidth, height: exactHeight };

  const width = Math.floor((size.width * scale) / alignment) * alignment;
  const height = Math.floor((size.height * scale) / alignment) * alignment;
  if (
    pixelLimits &&
    (width * height < pixelLimits.minimum ||
      width * height > pixelLimits.maximum)
  )
    return boundedAlignedSize(
      { width: size.width * scale, height: size.height * scale },
      alignment,
      pixelLimits,
    );
  if (width < alignment || height < alignment)
    throw invalid('No aligned video size fits the media limits');
  return { width, height };
}

/**
 * Selects aligned dimensions with the smallest relative error within area bounds.
 *
 * @param size The uniformly scaled target dimensions, in pixels.
 * @param alignment The required dimension multiple, in pixels.
 * @param pixelLimits The inclusive output area bounds.
 * @returns The valid dimensions minimizing relative width and height error.
 */
function boundedAlignedSize(
  size: MediaSize,
  alignment: number,
  pixelLimits: PixelLimits,
): MediaSize {
  const unitPixels = alignment * alignment;
  const minimumUnits = Math.ceil(pixelLimits.minimum / unitPixels);
  const maximumUnits = Math.floor(pixelLimits.maximum / unitPixels);
  let bestSize = { width: 0, height: 0 };
  let bestDistance = Infinity;
  for (let widthUnits = 1; widthUnits <= maximumUnits; widthUnits++) {
    const minimumHeight = Math.ceil(minimumUnits / widthUnits);
    const maximumHeight = Math.floor(maximumUnits / widthUnits);
    if (minimumHeight > maximumHeight) continue;

    const heightUnits = Math.min(
      maximumHeight,
      Math.max(minimumHeight, Math.round(size.height / alignment)),
    );
    const width = widthUnits * alignment;
    const height = heightUnits * alignment;
    const distance =
      ((width - size.width) / size.width) ** 2 +
      ((height - size.height) / size.height) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSize = { width, height };
    }
  }
  return bestSize;
}
