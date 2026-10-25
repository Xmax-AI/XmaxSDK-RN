//
//  ApiRequestURL.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { invalid } from '../../Foundation/Errors/XmaxError';

/**
 * Validates an HTTPS service root without issuing a request.
 *
 * @param value The absolute HTTPS API root.
 * @returns The validated service URL.
 */
export function validateAPIBaseURL(
  value: string
): URL {
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' && url.hostname) return url;
  } catch {
    // Invalid URLs share the configuration failure contract.
  }
  throw invalid('API service configuration is invalid');
}

/**
 * Resolves a trimmed request path under the configured HTTPS service host.
 *
 * @param baseURL The absolute HTTPS API root.
 * @param path The relative request path, with or without a leading slash.
 * @returns The authenticated request URL on the configured service host.
 */
export function makeAPIRequestURL(
  baseURL: string,
  path: string
): string {
  const base = validateAPIBaseURL(baseURL);
  const normalized = path.trim();
  if (!normalized || normalized.includes('://') || normalized.startsWith('//'))
    throw invalid('API request path is invalid');
  try {
    const result = new URL(
      `${base.href.replace(/\/$/, '')}${
        normalized.startsWith('/') ? normalized : `/${normalized}`
      }`,
    );
    if (
      result.protocol === base.protocol &&
      result.hostname.toLowerCase() === base.hostname.toLowerCase()
    )
      return result.href;
  } catch {
    // Reject malformed paths before exposing authentication headers to transport.
  }
  throw invalid('API request path is invalid');
}
