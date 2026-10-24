//
//  XmaxStorageManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Byte-based transfer progress. Total size and fraction are null when the total is unknown.
 */
export interface StorageProgress {

  /**
   * The number of bytes transferred.
   */
  readonly completedUnitCount: number;

  /**
   * The total number of bytes.
   */
  readonly totalUnitCount: number | null;

  /**
   * The completed fraction, from 0 to 1.
   */
  readonly fractionCompleted: number | null;
}

/**
 * A transfer progress handler whose exceptions do not interrupt the transfer.
 *
 * @param progress The current transfer progress.
 */
export type XmaxStorageProgressHandler = (
  progress: StorageProgress
) => void;

/**
 * The remote location and metadata of an uploaded file.
 */
export interface XmaxUploadedFile {

  /**
   * The remote file URL, or the safety service's approved URL for checked uploads.
   */
  readonly url: string;

  /**
   * The object key within the credential-authorized directory.
   */
  readonly objectKey: string;

  /**
   * The ETag returned by COS, or null if absent.
   */
  readonly etag: string | null;
}

/**
 * The location and size of a downloaded file.
 */
export interface XmaxDownloadedFile {

  /**
   * The destination file URL supplied by your app.
   */
  readonly fileURL: string;

  /**
   * The number of saved bytes.
   */
  readonly byteCount: number;
}

/**
 * Options for uploading a local image or video.
 */
export interface UploadFileOptions {

  /**
   * An absolute file:// URL. Copy content:// or photo-library assets to a readable local file
   * first.
   */
  readonly fileURL: string;

  /**
   * The media MIME type; inferred from the filename when omitted or null.
   */
  readonly contentType?: string | null;

  /**
   * The transfer progress handler. A fraction of 1 does not imply that a safety check has
   * completed.
   */
  readonly progress?: XmaxStorageProgressHandler | null;

  /**
   * Cancels this upload and its safety check without affecting other tasks.
   */
  readonly signal?: AbortSignal;
}

/**
 * Options for downloading a remote file into the app sandbox.
 */
export interface DownloadFileOptions {

  /**
   * The HTTP or HTTPS URL to download.
   */
  readonly remoteURL: string;

  /**
   * A writable file:// URL, atomically replaced when downloading succeeds.
   */
  readonly destinationURL: string;

  /**
   * The download progress handler. Notifications stop after completion or cancellation.
   */
  readonly progress?: XmaxStorageProgressHandler | null;

  /**
   * Cancels this download and removes its temporary file without affecting other tasks.
   */
  readonly signal?: AbortSignal;
}

/**
 * An interface for uploading and downloading media files.
 *
 * Obtain an instance from XmaxClient.createStorageManager(). Progress and cancellation are
 * configured per task.
 */
export interface XmaxStorageManaging {

  /**
   * Uploads an image using temporary COS credentials without a safety check.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The uploaded image URL, object key, and available ETag.
   */
  uploadImage(
    options: UploadFileOptions
  ): Promise<XmaxUploadedFile>;

  /**
   * Uploads an image and checks its content before returning.
   *
   * A rejected safety check reports UNSAFE_IMAGE.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The approved image URL and upload metadata.
   */
  uploadImageWithSafetyCheck(
    options: UploadFileOptions,
  ): Promise<XmaxUploadedFile>;

  /**
   * Uploads a video using temporary COS credentials.
   *
   * @param options The source file, MIME type, progress handler, and cancellation signal.
   * @returns The uploaded video URL, object key, and available ETag.
   */
  uploadVideo(
    options: UploadFileOptions
  ): Promise<XmaxUploadedFile>;

  /**
   * Downloads an image and atomically replaces the destination on success.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved image URL and byte count.
   */
  downloadImage(
    options: DownloadFileOptions
  ): Promise<XmaxDownloadedFile>;

  /**
   * Downloads a video and atomically replaces the destination on success.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved video URL and byte count.
   */
  downloadVideo(
    options: DownloadFileOptions
  ): Promise<XmaxDownloadedFile>;
}
