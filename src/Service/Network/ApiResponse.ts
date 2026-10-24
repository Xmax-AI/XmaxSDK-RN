//
//  ApiResponse.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Returns a record only for non-array objects; otherwise returns null.
 *
 * @param value The service data to inspect.
 */
export function record(
  value: unknown
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Trims a string and returns null for blank or nonstring input.
 *
 * @param value The text value to inspect.
 */
export function nonEmpty(
  value: unknown
): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
