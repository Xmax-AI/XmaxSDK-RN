//
//  BlobTransport.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The file transport interface used by storage without exposing vendor types.
 */
interface BlobResponse {

  /**
   * Reads response metadata without loading downloaded content.
   *
   * @returns The response metadata containing HTTP status.
   */
  info(): {

    /**
     * The HTTP response status code.
     */
    status: number;
  };
}

/**
 * A cancellable file request with byte-progress notifications.
 */
interface BlobRequest extends Promise<BlobResponse> {

  /**
   * Registers the download progress handler.
   *
   * @param options The download path and timeout, or progress-notification interval, in
   *   milliseconds.
   * @param callback The event or completion handler.
   * @returns The cancellable request, supporting chained registration and awaiting completion.
   */
  progress(
    options: {

      /**
       * The progress-notification interval, in milliseconds.
       */
      interval: number;
    },
    callback: (
      complete: number,
      total: number
    ) => void,
  ): BlobRequest;

  /**
   * Requests native download cancellation and notifies cancellation completion.
   *
   * @param callback The event or completion handler.
   */
  cancel(
    callback: () => void
  ): void;
}

/**
 * The file metadata and download operations required by storage.
 */
interface BlobTransport {

  /**
   * Native file metadata and removal operations used by storage.
   */
  fs: {

    /**
     * Reads file type and byte size to validate an upload source.
     *
     * @param path The local file path.
     * @returns The file type and byte size reported by native storage.
     */
    stat(
      path: string
    ): Promise<{

      /**
       * The native file type used to reject nonregular sources.
       */
      type: string;

      /**
       * The file byte count reported by native transport.
       */
      size: number | string;
    }>;

    /**
     * Removes a transfer's temporary file.
     *
     * Completes after deletion; rejects if native removal fails.
     *
     * @param path The local file path.
     */
    unlink(
      path: string
    ): Promise<void>;
  };

  /**
   * Creates a download configuration for a destination path and timeout.
   *
   * @param options The download path and timeout, or progress-notification interval, in
   *   milliseconds.
   */
  config(
    options: {

      /**
       * The transfer's absolute local path.
       */
      path: string;

      /**
       * The transfer timeout, in milliseconds.
       */
      timeout: number;
    }
  ): {

    /**
     * Starts a cancellable HTTP download using the configured destination.
     *
     * @param method The HTTP request method.
     * @param url An absolute HTTP or HTTPS URL.
     * @returns The cancellable request providing HTTP metadata after completion.
     */
    fetch(
      method: 'GET',
      url: string
    ): BlobRequest;
  };
}

/**
 * The native interface for file metadata, temporary file removal, and cancellable downloads.
 */
const Blob: BlobTransport = require('react-native-blob-util').default;

export default Blob;
