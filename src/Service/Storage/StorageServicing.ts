//
//  StorageServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxUploadedFile } from '../../Core/Storage/XmaxUploadedFile';
import type { XmaxDownloadedFile } from '../../Core/Storage/XmaxDownloadedFile';

import type {
  UploadFileOptions,
  DownloadFileOptions,
} from '../../Core/Storage/XmaxStorageManaging';

/**
 * An interface for media transfers, temporary credentials, and image safety checks.
 */
export interface StorageServicing {

  /**
   * Validates local media, requests temporary credentials, and uploads, optionally checking image
   * safety afterward.
   *
   * @param options The file URL or encoded bytes, filename, MIME type, progress handler, and cancellation signal.
   * @param media The image or video category used for file validation and MIME inference.
   * @param checksSafety Whether to check image safety after upload.
   * @returns The uploaded URL, object key, and available ETag.
   */
  upload(
    options: UploadFileOptions,
    media: 'image' | 'video',
    checksSafety: boolean,
  ): Promise<XmaxUploadedFile>;

  /**
   * Validates remote and destination URLs and downloads within independent cancellation scope.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved destination URL and byte count.
   */
  download(
    options: DownloadFileOptions
  ): Promise<XmaxDownloadedFile>;
}
