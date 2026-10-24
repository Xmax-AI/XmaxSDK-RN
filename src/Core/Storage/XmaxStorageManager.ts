//
//  XmaxStorageManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  XmaxStorageManaging,
  UploadFileOptions,
  DownloadFileOptions,
} from './XmaxStorageManaging';
import { StorageService } from '../../Service/Storage/StorageService';

/**
 * Provides public file transfer operations backed by the storage service.
 *
 * Your app accesses this implementation through XmaxStorageManaging.
 */
export class XmaxStorageManager implements XmaxStorageManaging {

  /**
   * Creates a storage manager.
   */
  constructor(
    /**
     * The service that validates files and manages independent transfers.
     */
    private readonly service: StorageService,
  ) {}

  /**
   * Uploads a local image using temporary credentials without a safety check.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The uploaded image URL, object key, and available ETag.
   */
  uploadImage(
    options: UploadFileOptions
  ) {
    return this.service.upload(
      options,
      'image',
      false
    );
  }

  /**
   * Uploads a local image and returns only after its safety check passes. Rejection reports
   * UNSAFE_IMAGE.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The approved image URL and upload metadata.
   */
  uploadImageWithSafetyCheck(
    options: UploadFileOptions
  ) {
    return this.service.upload(
      options,
      'image',
      true
    );
  }

  /**
   * Uploads a local video using temporary credentials.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The uploaded video URL, object key, and available ETag.
   */
  uploadVideo(
    options: UploadFileOptions
  ) {
    return this.service.upload(
      options,
      'video',
      false
    );
  }

  /**
   * Downloads an image to a temporary file and atomically replaces the destination on success.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved image URL and byte count.
   */
  downloadImage(
    options: DownloadFileOptions
  ) {
    return this.service.download(options);
  }

  /**
   * Downloads a video to a temporary file and atomically replaces the destination on success.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved video URL and byte count.
   */
  downloadVideo(
    options: DownloadFileOptions
  ) {
    return this.service.download(options);
  }
}
