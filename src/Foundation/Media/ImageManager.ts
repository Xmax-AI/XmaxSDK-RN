//
//  ImageManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ImageManaging } from './ImageManaging';
import NativeRuntime from '../Native/NativeXmaxRuntime';
import { invalid, XmaxError, XmaxErrorCode } from '../Errors/XmaxError';
import type { MediaSize } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * A service for image metadata and private copies without transferring pixels to JS.
 */
export class ImageManager implements ImageManaging {

  /**
   * Reads orientation-corrected dimensions without loading pixels into JS.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @returns The orientation-corrected dimensions, in pixels.
   */
  async size(
    fileURL: string
  ): Promise<MediaSize> {
    if (
      typeof fileURL !== 'string' ||
      !fileURL.trim() ||
      !/^(file:\/\/\/|content:\/\/|\/)/.test(fileURL)
    )
      throw invalid('A readable local image fileURL is required');

    try {
      const size = JSON.parse(
        await NativeRuntime.imageInfo(fileURL),
      ) as MediaSize;

      if (
        ![size.width, size.height].every(n => Number.isSafeInteger(n) && n > 0)
      )
        throw new Error('Invalid image dimensions');

      return size;
    } catch (error) {
      throw this.failure(error);
    }
  }

  /**
   * Creates an upright JPEG at the target dimensions; remove the copy after use.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param size The target copy dimensions, in pixels.
   * @returns The URL of the SDK-owned private copy.
   */
  async prepare(
    fileURL: string,
    size: MediaSize
  ): Promise<string> {
    try {
      const prepared = await NativeRuntime.prepareImage(
        fileURL,
        size.width,
        size.height,
      );

      if (!prepared.startsWith('file:///'))
        throw new Error(
          'Native image preparation returned an invalid file URL',
        );

      return prepared;
    } catch (error) {
      throw this.failure(error);
    }
  }

  /**
   * Deletes an SDK image copy while preserving the original input.
   *
   * Completes after deletion or if the copy is absent; foreign files cannot be removed.
   *
   * @param fileURL The SDK-owned private image copy URL returned by image preparation.
   */
  async remove(
    fileURL: string
  ): Promise<void> {
    await NativeRuntime.removePreparedImage(fileURL);
  }

  /**
   * Normalizes native image-operation failures as SDK errors.
   *
   * @param error The failure reported by the operation.
   */
  private failure(
    error: unknown
  ): XmaxError {
    return new XmaxError({
      code: XmaxErrorCode.mediaError,
      message:
        error instanceof Error ? error.message : 'Unable to prepare image',
    });
  }
}
