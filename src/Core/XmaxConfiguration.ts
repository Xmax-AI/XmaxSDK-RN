//
//  XmaxConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxEnvironment } from './XmaxEnvironment';

export {
  XmaxEnvironment,
  apiBaseURLs,
  realtimeAPIBaseURL,
} from './XmaxEnvironment';

export { XmaxLoggerOption } from '../Foundation/Logging/XmaxLoggerOption';

/**
 * The credentials, service environment, and logging options for an Xmax client.
 */
export interface XmaxConfiguration {

  /**
   * The API key for service requests; local preview permits an empty key.
   */
  readonly apiKey: string;

  /**
   * The service environment and log-detail language; defaults to XmaxEnvironment.china.
   * China uses Chinese details; global uses English details. Model selection does not change routing.
   */
  readonly environment?: XmaxEnvironment;

  /**
   * An absolute HTTPS API root override. Empty, null, or omitted values use environment routing.
   */
  readonly baseURL?: string | null;

  /**
   * The global XmaxLoggerOption bitmask. Defaults to 0. The most recently created client determines
   * logging for all services.
   */
  readonly loggerOptions?: number;
}
