//
//  StorageService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { DataFileManager } from '../../Foundation/Storage/DataFileManager';
import type { DataFileManaging } from '../../Foundation/Storage/DataFileManaging';
import { copyEncodedData } from '../../Foundation/Storage/EncodedData';
import { invalid } from '../../Foundation/Errors/XmaxError';
import type { StorageServicing } from './StorageServicing';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { ApiServicing } from '../Network/ApiServicing';
import { record, nonEmpty } from '../Network/ApiResponse';
import { XmaxError, XmaxErrorCode } from '../../Foundation/Errors/XmaxError';
import { abortable } from '../../Foundation/Runtime/Async';
import type { StorageProgress } from '../../Core/Storage/StorageProgress';
import type {
  UploadFileOptions,
  DownloadFileOptions,
} from '../../Core/Storage/XmaxStorageManaging';
import type { StorageManaging } from '../../Foundation/Storage/StorageManaging';
import {
  uploadMetadata,
  parseStorageConfiguration,
  httpURL,
  filePath,
} from './StorageValidation';

/**
 * Coordinates media transfers, temporary credentials, and image safety checks.
 */
export class StorageService implements StorageServicing {

  /**
   * Creates a storage service.
   */
  constructor(
    /**
     * The authenticated HTTP request interface.
     */
    private readonly api: ApiServicing,

    /**
     * The upload and download transport implementation.
     */
    private readonly storage: StorageManaging,

    /**
     * The function producing unique task, file, or message identifiers.
     */
    private readonly uuid: () => string,

    /**
     * The millisecond clock for object naming and elapsed time.
     *
     * @returns The current system time, in milliseconds.
     */
    private readonly now: () => number = Date.now,

    /**
     * The private staging files for encoded memory uploads.
     */
    private readonly dataFiles: DataFileManaging = new DataFileManager(),
  ) {}

  /**
   * Validates local media, requests temporary credentials, and uploads, optionally checking image
   * safety afterward.
   *
   * @param options The file URL or encoded bytes, filename, MIME type, progress handler, and cancellation signal.
   * @param media The image or video category used for file validation and MIME inference.
   * @param checksSafety Whether to check image safety after upload.
   * @returns The uploaded URL, object key, and available ETag.
   */
  async upload(
    options: UploadFileOptions,
    media: 'image' | 'video',
    checksSafety: boolean,
  ) {
    if (
      !options ||
      (options.fileURL !== undefined) === (options.data !== undefined)
    )
      throw invalid('Supply exactly one upload fileURL or data source');
    const data =
      options.data !== undefined ? copyEncodedData(options.data) : null;
    if (
      data &&
      (typeof options.fileName !== 'string' ||
        !options.fileName.trim() ||
        /[\\/\0]/.test(options.fileName) ||
        typeof options.contentType !== 'string')
    )
      throw invalid(
        'Memory uploads require a filename without path separators and a MIME type',
      );
    return this.operation(
      options,
      XmaxErrorCode.uploadError,
      async (signal, progress) => {
        const metadata = uploadMetadata(
          data
            ? `file:///memory/${encodeURIComponent(options.fileName!)}`
            : options.fileURL!,
          media,
          options.contentType,
        );

        let temporary: string | null = null;
        try {
          if (data) temporary = await this.dataFiles.create(data);
          if (signal.aborted)
            throw new XmaxError({
              code: XmaxErrorCode.cancelled,
              message: 'Storage operation cancelled',
            });
          const fileURL = temporary ?? options.fileURL!;
          await abortable(
            this.storage.fileSize(fileURL),
            signal
          );

          const config = parseStorageConfiguration(
            await abortable(
              this.api.request(
                'GET',
                '/cos/sts',
                undefined,
                signal
              ),
              signal,
            ),
          );
          const objectKey = `${
            config.prefix
          }${this.now()}_${this.uuid().toLowerCase()}_${metadata.fileName}`;
          const stored = await this.storage.upload({
            fileURL,
            objectKey,
            contentType: metadata.contentType,
            configuration: config,
            signal,
            progress,
          });

          if (signal.aborted)
            throw new XmaxError({
              code: XmaxErrorCode.cancelled,
              message: 'Storage operation cancelled',
            });
          if (!checksSafety) return stored;

          const payload = record(
            await abortable(
              this.api.request(
                'POST',
                '/cos/image/check',
                { url: stored.url },
                signal,
              ),
              signal,
            ),
          );

          if (typeof payload?.safe !== 'boolean')
            throw new XmaxError({
              code: XmaxErrorCode.apiError,
              message: 'Invalid image safety check payload',
            });
          if (!payload.safe)
            throw new XmaxError({
              code: XmaxErrorCode.unsafeImage,
              message: 'The image did not pass the safety check',
            });

          const checkedURL = nonEmpty(payload.url);

          if (!checkedURL)
            throw new XmaxError({
              code: XmaxErrorCode.apiError,
              message: 'Safety check returned no URL',
            });

          return { ...stored, url: httpURL(checkedURL).href };
        } finally {
          if (temporary) await this.dataFiles.remove(temporary);
        }
      },
    );
  }

  /**
   * Validates remote and destination URLs and downloads within independent cancellation scope.
   *
   * @param options The remote URL, destination, progress handler, and cancellation signal.
   * @returns The saved destination URL and byte count.
   */
  async download(
    options: DownloadFileOptions
  ) {
    return this.operation(
      options,
      XmaxErrorCode.downloadError,
      async (signal, progress) => {
        httpURL(options.remoteURL);
        filePath(options.destinationURL);

        return this.storage.download({ ...options, signal, progress });
      },
    );
  }

  /**
   * Runs an isolated transfer with protected progress callbacks and a 15-minute overall timeout.
   *
   * @param options The transfer URLs, progress handler, and task cancellation signal.
   * @param code The SDK or service error code for this operation.
   * @param run The asynchronous transfer operation under current cancellation and progress
   *   ownership.
   * @returns Validates transfer completion against timeout and cancellation; rejects with
   *   normalized transfer errors.
   */
  private async operation<T>(
    options: Pick<UploadFileOptions, 'signal' | 'progress'>,
    code: XmaxErrorCode,
    run: (
      signal: AbortSignal,
      progress: (
        p: StorageProgress
      ) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const action = () =>
      code === XmaxErrorCode.uploadError
        ? XmaxLogger.localized(
          '上传',
          'Upload'
        )
        : XmaxLogger.localized(
          '下载',
          'Download'
        );
    const started = this.now();
    XmaxLogger.storage.info(
      `${action()}${XmaxLogger.localized('开始', ' started')}`,
    );

    const controller = new AbortController();
    const abort = () => controller.abort();
    let finished = false,
      timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      15 * 60 * 1000
    );

    options.signal?.addEventListener(
      'abort',
      abort
    );
    if (options.signal?.aborted) controller.abort();

    try {
      if (controller.signal.aborted) throw new Error('Cancelled');

      const result = await run(
        controller.signal,
        value => {
          if (finished || controller.signal.aborted) return;

          try {
            options.progress?.(value);
          } catch {
            XmaxLogger.storage.warn(
              XmaxLogger.localized(
                '进度监听器抛出异常',
                'Progress listener threw an exception',
              ),
            );
          }
        }
      );

      XmaxLogger.storage.info(
        () =>
          `${action()}${XmaxLogger.localized('完成，耗时：', ' completed in ')}${this.now() - started} ms`,
      );

      return result;
    } catch (error) {
      XmaxLogger.storage.error(
        () =>
          `${action()}${XmaxLogger.localized('失败：', ' failed: ')}${
            controller.signal.aborted
              ? timedOut
                ? XmaxErrorCode.timeout
                : XmaxErrorCode.cancelled
              : error instanceof XmaxError
              ? error.code
              : code
          }`,
      );
      if (controller.signal.aborted)
        throw new XmaxError({
          code: timedOut ? XmaxErrorCode.timeout : XmaxErrorCode.cancelled,
          message: timedOut
            ? 'Storage operation timed out'
            : 'Storage operation cancelled',
        });
      if (error instanceof XmaxError) throw error;

      throw new XmaxError({
        code,
        message:
          code === XmaxErrorCode.uploadError
            ? 'Storage upload failed'
            : 'Storage download failed',
      });
    } finally {
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener(
        'abort',
        abort
      );
    }
  }
}
