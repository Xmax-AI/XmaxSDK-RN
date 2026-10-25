//
//  StorageService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { StorageLogger } from './StorageLogger';
import { MediaFileMetadataManager } from '../../Foundation/Media/MediaFileMetadataManager';
import type { MediaFileMetadataManaging } from '../../Foundation/Media/MediaFileMetadataManaging';
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
import { parseStorageConfiguration } from './StorageValidation';
import {
  uploadMetadata,
  uploadDataMetadata,
  httpURL,
  filePath,
} from '../../Foundation/Storage/StorageValidation';

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

    /**
     * The encoded-file metadata reader used for safe upload diagnostics.
     */
    private readonly metadata: MediaFileMetadataManaging = new MediaFileMetadataManager(),
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
        typeof options.contentType !== 'string')
    )
      throw invalid('Memory uploads require a filename and a MIME type');
    return this.operation(
      options,
      XmaxErrorCode.uploadError,
      async (signal, progress) => {
        const metadata = data
          ? uploadDataMetadata(
            options.fileName!,
            media,
            options.contentType
          )
          : uploadMetadata(
            options.fileURL!,
            media,
            options.contentType
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
          const byteCount = await abortable(
            this.storage.fileSize(fileURL),
            signal,
          );
          const size = XmaxLogger.isEnabled(1)
            ? await abortable(
                this.metadata.readMetadata(
                  fileURL,
                  media
                ).catch(() => null),
                signal,
              )
            : null;
          StorageLogger.uploadStarted(
            media,
            size,
            byteCount,
            checksSafety
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
   * Runs an isolated transfer with protected progress callbacks and transport-owned timeouts.
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
    if (code === XmaxErrorCode.downloadError)
      XmaxLogger.storage.info('开始下载 (Download Started)');

    const controller = new AbortController();
    const abort = () => controller.abort();
    let finished = false;

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
          `${
            code === XmaxErrorCode.uploadError
              ? '上传完成 (Upload Completed)'
              : '下载完成 (Download Completed)'
          }\n└─ ${XmaxLogger.localized('耗时：', 'Duration: ')}${StorageLogger.formatDuration(this.now() - started)}`,
      );

      return result;
    } catch (error) {
      XmaxLogger.storage.error(
        () =>
          `${action()}${XmaxLogger.localized('失败 (Failed)', ' Failed')}\n├─ ${XmaxLogger.localized('错误码：', 'Error Code: ')}${
            controller.signal.aborted
              ? XmaxErrorCode.cancelled
              : error instanceof XmaxError
              ? error.code
              : code
          }\n└─ ${XmaxLogger.localized('耗时：', 'Duration: ')}${StorageLogger.formatDuration(this.now() - started)}`,
      );
      if (controller.signal.aborted)
        throw new XmaxError({
          code: XmaxErrorCode.cancelled,
          message: 'Storage operation cancelled',
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
      options.signal?.removeEventListener(
        'abort',
        abort
      );
    }
  }
}
