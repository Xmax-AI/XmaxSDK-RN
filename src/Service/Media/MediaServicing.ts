//
//  MediaServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeModel } from '../Realtime/RealtimeModel';
import type { RealtimeMediaSource } from './RealtimeMediaSource';
import type { MediaSize } from '../Realtime/RealtimeVideoFormat';

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
   * Resolves local media dimensions within the model area limits and validates camera buckets.
   * Images are upscaled or downscaled as needed, preserving exact aspect ratio when possible.
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
