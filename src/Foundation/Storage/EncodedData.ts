//
//  EncodedData.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { invalid } from '../Errors/XmaxError';

/**
 * Copies an encoded media payload, retaining only the selected byte view.
 *
 * @param data The nonempty encoded file bytes; raw pixel and PCM buffers are not accepted inputs.
 * @returns An independent byte snapshot that your app can no longer mutate.
 */
export function copyEncodedData(
  data: Uint8Array
): Uint8Array {
  if (!(data instanceof Uint8Array) || data.byteLength === 0)
    throw invalid('Encoded media data must be a nonempty Uint8Array');
  return new Uint8Array(data);
}
