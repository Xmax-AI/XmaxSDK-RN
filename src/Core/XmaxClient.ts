//
//  XmaxClient.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../Foundation/Logging/XmaxLogger';
import { XmaxStorageManager } from './Storage/XmaxStorageManager';
import type { XmaxStorageManaging } from './Storage/XmaxStorageManaging';
import { StorageService } from '../Service/Storage/StorageService';
import { StorageManager } from '../Foundation/Storage/StorageManager';
import { ApiService } from '../Service/Network/ApiService';
import NativeRuntime from '../Foundation/Native/NativeXmaxRuntime';
import { apiBaseURLs, XmaxEnvironment } from './XmaxEnvironment';
import type { XmaxConfiguration } from './XmaxConfiguration';
import { RealtimeModel } from '../Service/Realtime/RealtimeModel';
import type { RealtimeConfiguration } from './Realtime/RealtimeConfiguration';
import { invalid } from '../Foundation/Errors/XmaxError';
import { XmaxRealtimeManager } from './Realtime/XmaxRealtimeManager';
import type { XmaxRealtimeManaging } from './Realtime/XmaxRealtimeManaging';
import { MediaService } from '../Service/Media/MediaService';
import type { MediaServicing } from '../Service/Media/MediaServicing';

/**
 * A client that provides access to Xmax realtime generation, storage, and media services.
 *
 * Client creation does not request permissions or connect. Close each realtime manager when your
 * app finishes using it.
 */
export class XmaxClient {

  /**
   * The normalized, immutable configuration shared by this client's services.
   */
  readonly configuration: Readonly<Required<XmaxConfiguration>>;

  /**
   * Creates a client with the specified configuration.
   *
   * An empty API key permits local preview. Invalid configuration throws XmaxError synchronously.
   *
   * @param configuration The client configuration.
   */
  constructor(
    configuration: XmaxConfiguration
  ) {
    if (!configuration || typeof configuration.apiKey !== 'string')
      throw invalid('API key must be a string');

    const environment = configuration.environment ?? XmaxEnvironment.china;
    const loggerOptions = configuration.loggerOptions ?? 0;

    if (
      !Object.values(XmaxEnvironment).includes(environment) ||
      !Number.isInteger(loggerOptions) ||
      loggerOptions < 0 ||
      (loggerOptions & ~3) !== 0
    )
      throw invalid('Invalid Xmax configuration');

    this.configuration = Object.freeze({
      apiKey: configuration.apiKey.trim(),
      environment,
      loggerOptions,
    });

    NativeRuntime.configureLogging(loggerOptions);
    XmaxLogger.configure(
      loggerOptions,
      (level, message, option) => {
        NativeRuntime.writeLog(
          level,
          message,
          option
        );
      },
      environment === XmaxEnvironment.china ? 'chinese' : 'english',
    );
  }

  /**
   * Creates a manager for local media inputs and realtime generation.
   *
   * Camera capture starts when createLocalCameraStream() is called. Close the manager after use.
   *
   * @param options The generation model and its media capabilities.
   */
  createRealtimeManager(
    options: RealtimeConfiguration
  ): XmaxRealtimeManaging {
    if (!options || !Object.values(RealtimeModel).includes(options.model))
      throw invalid('Unsupported realtime model');
    if (
      options.isAdaptiveQualityEnabled !== undefined &&
      typeof options.isAdaptiveQualityEnabled !== 'boolean'
    )
      throw invalid('isAdaptiveQualityEnabled must be a boolean');

    return new XmaxRealtimeManager(
      this.configuration,
      options
    );
  }

  /**
   * Creates a manager for uploading and downloading media files.
   *
   * An empty API key throws synchronously. Storage tasks are independent of realtime close().
   */
  createStorageManager(): XmaxStorageManaging {
    if (!this.configuration.apiKey) throw invalid('API key cannot be empty');

    const runtime = {
      ...JSON.parse(NativeRuntime.runtimeInfo()),
      sdk_version: '1.0.4',
    };

    return new XmaxStorageManager(
      new StorageService(
        new ApiService(
          this.configuration.apiKey,
          apiBaseURLs[this.configuration.environment],
          runtime,
        ),
        new StorageManager(),
        () => NativeRuntime.randomUUID(),
      ),
    );
  }

  /**
   * Creates a service for media sizing and capability queries.
   *
   * The default model is x2.1.1-preview-cn. Creation does not allocate camera or RTC resources.
   *
   * @param model The model defining sizing rules; defaults to x2.1.1-preview-cn.
   */
  createMediaService(
    model: RealtimeModel = RealtimeModel.x2_1_1_preview_cn,
  ): MediaServicing {
    if (!Object.values(RealtimeModel).includes(model))
      throw invalid('Unsupported realtime model');

    return new MediaService(model);
  }
}
