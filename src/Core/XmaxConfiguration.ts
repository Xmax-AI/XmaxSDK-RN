//
//  XmaxConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The realtime and storage service environment; an explicit baseURL overrides service routing.
 */
export enum XmaxEnvironment {

  /**
   * The China service environment.
   */
  china = 'china',

  /**
   * The global service environment.
   */
  global = 'global',
}

/**
 * Log categories that can be combined with bitwise OR.
 */
export enum XmaxLoggerOption {

  /**
   * Lifecycle, request, and business-operation logs.
   */
  business = 1,

  /**
   * Video statistics and encoder performance logs.
   */
  performance = 2,

  /**
   * All log categories.
   */
  all = 3,
}

/**
 * The credentials, service environment, and logging options for an Xmax client.
 */
export interface XmaxConfiguration {

  /**
   * The API key for service requests; local preview permits an empty key.
   */
  readonly apiKey: string;

  /**
   * The service environment; defaults to XmaxEnvironment.china.
   */
  readonly environment?: XmaxEnvironment;

  /**
   * An absolute HTTP(S) API root override. Empty, null, or omitted values use environment routing.
   */
  readonly baseURL?: string | null;

  /**
   * The global XmaxLoggerOption bitmask. Defaults to 0. The most recently created client determines
   * logging for all services.
   */
  readonly loggerOptions?: number;
}

/**
 * The default storage API roots by environment.
 */
export const apiBaseURLs = {
  [XmaxEnvironment.china]: 'https://cloud.xmax.22duck.cn/open/api/v1',
  [XmaxEnvironment.global]: 'https://api.xmax.cloud/open/api/v1',
};

/**
 * Resolves the realtime API root for a service environment.
 *
 * @param environment The client's service environment.
 * @returns The realtime API root for that environment.
 */
export function realtimeAPIBaseURL(
  environment: XmaxEnvironment
): string {
  return environment === XmaxEnvironment.global
    ? 'https://api.xmax.ai/open/api/v1'
    : 'https://cloud.xmax.22duck.cn/open/api/v1';
}
