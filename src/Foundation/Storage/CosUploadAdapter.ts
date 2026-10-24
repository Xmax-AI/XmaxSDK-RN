//
//  CosUploadAdapter.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { TurboModuleRegistry } from 'react-native';
import type { Spec as CosNative } from 'react-native-cos-sdk-nobeacon/lib/typescript/NativeQCloudCosReactNative';
import type {
  CosXmlClientError,
  CosXmlServiceError,
} from 'react-native-cos-sdk-nobeacon/lib/typescript/data_model/errors';
import NativeRuntime from '../Native/NativeXmaxRuntime';

/**
 * The callback interface owned by an SDK transfer manager.
 */
interface CosCallbacks {

  /**
   * Delivers native upload success to its task.
   *
   * @param key The native transfer-manager or request identity used for callback routing.
   * @param headers The transfer response headers.
   */
  runResultSuccessCallBack(
    key: string,
    headers?: object
  ): void;

  /**
   * Delivers native client or server errors to the upload task.
   *
   * @param key The native transfer-manager or request identity used for callback routing.
   * @param client The COS client failure.
   * @param service The COS server failure with response status and safe diagnostic codes.
   */
  runResultFailCallBack(
    key: string,
    client?: CosXmlClientError,
    service?: CosXmlServiceError,
  ): void;

  /**
   * Delivers byte progress to the matching active upload.
   *
   * @param key The native transfer-manager or request identity used for callback routing.
   * @param complete The number of bytes transferred.
   * @param total The expected byte count; nonpositive or omitted values indicate an unknown total.
   */
  runProgressCallBack(
    key: string,
    complete: number,
    total: number
  ): void;
}

/**
 * Registers native COS callbacks independently for each SDK upload manager.
 */
interface CosRegistration {

  /**
   * Creates an isolated native transfer manager for an endpoint and transport policy.
   *
   * @param key The native transfer-manager or request identity used for callback routing.
   * @param configuration The client configuration.
   * @param policy The native transfer policy, including upload method and retry configuration.
   * @returns The callback dispatcher for an isolated manager.
   */
  registerTransferManger(
    key: string,
    configuration: object,
    policy: object,
  ): Promise<CosCallbacks>;
}

/**
 * The native COS registration interface isolating SDK transfer managers by endpoint.
 */
const Cos: CosRegistration = require('react-native-cos-sdk-nobeacon').default;

/**
 * Temporary credentials, cancellation, progress, and result handlers for one upload.
 */
interface UploadParameters {

  /**
   * The operation's cancellation signal.
   */
  signal: AbortSignal;

  /**
   * The destination COS bucket region.
   */
  region: string;

  /**
   * The temporary credentials used only for this upload; never log them.
   */
  sessionCredentials: object;

  /**
   * The HTTP headers for this upload request.
   */
  customHeaders: object;

  /**
   * Delivers completed and total byte counts to the progress handler.
   *
   * @param complete The number of bytes transferred.
   * @param total The expected byte count; nonpositive or omitted values indicate an unknown total.
   */
  progressCallback(
    complete: number,
    total: number
  ): void;

  /**
   * The result handler retained until completion or cancellation.
   */
  resultListener: {

    /**
     * Completes upload by resolving the remote URL and ETag from response headers.
     *
     * @param headers The transfer response headers.
     */
    successCallBack(
      headers?: object
    ): void;

    /**
     * Ends upload with a normalized client or server error.
     *
     * @param client The COS client failure.
     * @param service The COS server failure with response status and safe diagnostic codes.
     */
    failCallBack(
      client?: CosXmlClientError,
      service?: CosXmlServiceError,
    ): void;
  };
}

/**
 * Cancels the native task and releases JS handlers.
 */
export interface CosUploadTask {

  /**
   * Cancels the native upload and releases completion and progress handlers.
   *
   * Completes after native cancellation and callback release.
   */
  cancel(): Promise<void>;
}

/**
 * A task-specific callback adapter using native COS transfers and global events without vendor
 * patches.
 */
export class CosUploadAdapter {

  /**
   * The tasks awaiting submission or native completion.
   */
  private readonly pending = new Map<
    string,
    {

      /**
       * The credentials, cancellation settings, and handlers retained for one upload.
       */
      parameters: UploadParameters;

      /**
       * Releases upload handlers and cancellation observation when a task ends.
       */
      cleanup(): void;
    }
  >();

  /**
   * Creates a callback dispatcher for an isolated transfer manager.
   *
   * @param key The native transfer-manager or request identity used for callback routing.
   * @param manager The native manager whose callbacks are dispatched.
   * @param native The native module that executes and cancels transfers.
   */
  private constructor(
    /**
     * The native transfer-manager or request identity used for callback routing.
     */
    private readonly key: string,
    manager: CosCallbacks,

    /**
     * The native module that executes and cancels transfers.
     */
    private readonly native: CosNative,
  ) {
    manager.runResultSuccessCallBack = (id, headers) => {
      const task = this.pending.get(id);
      task?.cleanup();
      task?.parameters.resultListener.successCallBack(headers);
    };
    manager.runResultFailCallBack = (id, client, service) => {
      const task = this.pending.get(id);
      task?.cleanup();
      task?.parameters.resultListener.failCallBack(
        client,
        service
      );
    };
    manager.runProgressCallBack = (id, complete, total) => {
      this.pending.get(id)?.parameters.progressCallback(
        complete,
        total
      );
    };
  }

  /**
   * Registers an isolated COS transfer manager.
   *
   * @param configuration The client configuration.
   * @param policy The native transfer policy, including upload method and retry configuration.
   * @returns The upload adapter for the endpoint and transport policy.
   */
  static async register(
    configuration: object,
    policy: object,
  ): Promise<CosUploadAdapter> {
    const key = `xmax:simple:${NativeRuntime.randomUUID()}`;
    const manager = await Cos.registerTransferManger(
      key,
      configuration,
      policy,
    );
    return new CosUploadAdapter(
      key,
      manager,
      TurboModuleRegistry.getEnforcing<CosNative>('QCloudCosReactNative'),
    );
  }

  /**
   * Uploads a file and releases its callbacks on completion or cancellation, including cancellation
   * before task identifier delivery.
   *
   * @param bucket The destination COS bucket.
   * @param objectKey The remote object key within the authorized directory.
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param parameters The upload credentials, headers, cancellation settings, and result handlers.
   * @returns The upload cancellation handle; results are delivered through completion handlers.
   */
  async upload(
    bucket: string,
    objectKey: string,
    fileURL: string,
    parameters: UploadParameters,
  ): Promise<CosUploadTask> {
    const id = NativeRuntime.randomUUID();
    const cleanup = () => {
      this.pending.delete(id);
      parameters.signal.removeEventListener(
        'abort',
        cleanup
      );
    };
    if (parameters.signal.aborted) throw new Error('Upload cancelled');
    this.pending.set(
      id,
      { parameters, cleanup }
    );
    parameters.signal.addEventListener(
      'abort',
      cleanup
    );

    try {
      const taskID = await this.native.upload(
        this.key,
        bucket,
        objectKey,
        fileURL,
        null,
        id,
        null,
        id,
        null,
        null,
        null,
        parameters.region,
        parameters.sessionCredentials,
        parameters.customHeaders,
        null,
      );
      return {
        cancel: async () => {
          cleanup();
          await this.native.cancel(
            this.key,
            taskID
          );
        },
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}
