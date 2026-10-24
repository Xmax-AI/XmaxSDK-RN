//
//  XmaxEnvironment.ts
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
