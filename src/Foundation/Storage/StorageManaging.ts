//
//  StorageManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { StoredFile } from './StoredFile';
import type { DownloadedFile } from './DownloadedFile';
import type { StorageProgress } from './StorageProgress';

import type { StorageConfiguration } from './StorageConfiguration';

/**
 * The internal StorageService transport interface, without vendor objects.
 */
export interface StorageManaging {

  /**
   * Requires a regular upload source and reads its byte size.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @returns The file size, in bytes; rejects unreadable files and nonregular sources.
   */
  fileSize(
    fileURL: string
  ): Promise<number>;

  /**
   * Uploads a validated file with request-specific credentials and cancellation.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The uploaded URL, object key, and available ETag.
   */
  upload(
    options: {

      /**
       * The readable upload source URL; your app retains the original file.
       */
      fileURL: string;

      /**
       * The remote object key within the authorized storage directory.
       */
      objectKey: string;

      /**
       * The media MIME type used for file validation and Content-Type.
       */
      contentType: string;

      /**
       * The transfer's validated bucket, endpoint, and temporary credentials.
       */
      configuration: StorageConfiguration;

      /**
       * The byte-progress handler, stopped after completion or cancellation.
       *
       * @param value The completed bytes, total size, and completed fraction.
       */
      progress: (
        value: StorageProgress
      ) => void;

      /**
       * The operation's cancellation signal.
       */
      signal: AbortSignal;
    }
  ): Promise<StoredFile>;

  /**
   * Downloads a remote file and replaces the destination only after complete success.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved destination URL and byte count.
   */
  download(
    options: {

      /**
       * The HTTP or HTTPS URL to download.
       */
      remoteURL: string;

      /**
       * The writable destination file URL, atomically replaced on success.
       */
      destinationURL: string;

      /**
       * The byte-progress handler, stopped after completion or cancellation.
       *
       * @param value The completed bytes, total size, and completed fraction.
       */
      progress: (
        value: StorageProgress
      ) => void;

      /**
       * The operation's cancellation signal.
       */
      signal: AbortSignal;
    }
  ): Promise<DownloadedFile>;
}
