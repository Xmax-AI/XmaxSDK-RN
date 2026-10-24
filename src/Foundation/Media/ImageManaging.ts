//
//  ImageManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaSize } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * An interface for image metadata, private prepared copies, and copy cleanup.
 */
export interface ImageManaging {

  /**
   * Reads orientation-corrected dimensions without loading pixels into JS.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @returns The orientation-corrected dimensions, in pixels.
   */
  size(
    fileURL: string
  ): Promise<MediaSize>;

  /**
   * Creates an upright JPEG at the target dimensions; remove the copy after use.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param size The target copy dimensions, in pixels.
   * @returns The URL of the SDK-owned private copy.
   */
  prepare(
    fileURL: string,
    size: MediaSize
  ): Promise<string>;

  /**
   * Deletes an SDK image copy while preserving the original input.
   *
   * Completes after deletion or if the copy is absent; foreign files cannot be removed.
   *
   * @param fileURL The SDK-owned private image copy URL returned by image preparation.
   */
  remove(
    fileURL: string
  ): Promise<void>;
}
