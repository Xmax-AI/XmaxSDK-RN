//
//  MediaService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { invalid } from '../../Foundation/Errors/XmaxError';
import {
  RealtimeMediaSource,
  RealtimeModel,
  realtimeModelSpecifications,
  type MediaSize,
} from '../Realtime/RealtimeTypes';

/**
 * An interface for calculating aspect-preserving local media, generation canvas, and returned media
 * dimensions.
 */
export interface MediaServicing {

  /**
   * The model that determines local media constraints and generation canvases.
   */
  readonly model: RealtimeModel;

  /**
   * Resolves local media dimensions without upscaling and validates camera resolution buckets.
   *
   * @param size The source media dimensions, in pixels.
   * @param source The local media source.
   */
  resolveMediaSize(
    size: MediaSize,
    source: RealtimeMediaSource
  ): MediaSize;

  /**
   * Selects the closest generation canvas without changing the local source dimensions.
   *
   * @param size The source media dimensions, in pixels.
   */
  resolveGenerationSize(
    size: MediaSize
  ): MediaSize;

  /**
   * Downscales source media to the network quality limit, aligning each dimension to 4 pixels.
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
  ): MediaSize;
}

/**
 * The sizing and capability rules for local media, generation canvases, and returned media.
 */
export class MediaService implements MediaServicing {

  /**
   * Creates a sizing service for the specified model without allocating media resources.
   */
  constructor(
    /**
     * The generation model used for sizing; defaults to x2.1.
     */
    readonly model: RealtimeModel = RealtimeModel.x2_1,
  ) {}

  /**
   * Validates the input type and calculates aligned dimensions without upscaling images. Camera
   * dimensions must match a supported model format.
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
      !spec.supportedVideoFormats.some(
        bucket => bucket.width === size.width && bucket.height === size.height,
      )
    )
      throw invalid('Camera dimensions must match a model resolution bucket');

    const scale = Math.min(
      1,
      Math.sqrt(spec.maximumInputPixels / (size.width * size.height)),
    );
    return alignedSize(
      size,
      scale,
      4
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
    validateSize(size);
    const buckets =
      realtimeModelSpecifications[this.model].supportedVideoFormats;
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
 * Preserves the reduced source aspect ratio exactly when integer dimensions satisfying the
 * alignment exist.
 *
 * @param size The source media dimensions, in pixels.
 * @param scale The positive scale factor; values at or below 1 do not upscale the source.
 * @param alignment The positive integer pixel multiple required for both output dimensions.
 */
export function alignedSize(
  size: MediaSize,
  scale: number,
  alignment: number,
): MediaSize {
  let divisor = size.width;
  let remainder = size.height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const units = Math.floor((divisor * scale) / alignment) * alignment;
  if (units >= alignment)
    return {
      width: (size.width / divisor) * units,
      height: (size.height / divisor) * units,
    };
  const width = Math.floor((size.width * scale) / alignment) * alignment;
  const height = Math.floor((size.height * scale) / alignment) * alignment;
  if (width < alignment || height < alignment)
    throw invalid('No aligned video size fits the media limits');
  return { width, height };
}
