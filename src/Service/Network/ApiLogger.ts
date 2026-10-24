//
//  ApiLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';

/**
 * Logs request durations and safe response metadata without copying sensitive content.
 */
export class ApiLogger {

  /**
   * Calculates UTF-8 response size without browser TextEncoder.
   *
   * @param text The text used for safe metadata extraction or byte-length calculation.
   */
  static byteLength(
    text: string
  ): number {
    let bytes = 0;

    for (const character of text) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }

    return bytes;
  }

  /**
   * Retains only SDK endpoint structure, excluding query parameters and resource identities.
   *
   * @param path The request path relative to the API root.
   * @returns The filtered API path without credentials or user query content.
   */
  static path(
    path: string
  ): string {
    return path
      .split('?')[0]!
      .split('/')
      .map(part =>
        [
          'realtime',
          'sessions',
          'session',
          'cos',
          'sts',
          'image',
          'check',
          '',
        ].includes(part)
          ? part
          : ':id',
      )
      .join('/');
  }

  /**
   * Logs HTTP status, measured response size, and permitted business response fields.
   *
   * @param method The HTTP request method.
   * @param path The request path relative to the API root.
   * @param status The HTTP response status.
   * @param bytes The UTF-8 packet or response byte count.
   * @param duration The request duration, in milliseconds.
   * @param successful Whether both HTTP and business responses succeeded.
   * @param code The SDK or service error code for this operation.
   */
  static response(
    method: string,
    path: string,
    status: number,
    bytes: number,
    duration: number,
    successful: boolean,
    code: unknown,
  ): void {
    const message = () =>
      `${method} ${this.path(path)}\n` +
      `├─ ${XmaxLogger.localized('状态：', 'Status: ')}${status}\n` +
      `├─ ${XmaxLogger.localized('耗时：', 'Duration: ')}${duration} ms\n` +
      `└─ ${XmaxLogger.localized('响应：', 'Response Size: ')}${bytes} bytes` +
      (successful
        ? ''
        : `\n${XmaxLogger.localized('失败响应：', 'Failure: ')}code=${
            typeof code === 'number'
              ? code
              : XmaxLogger.localized('不可用', 'unavailable')
          }; ${XmaxLogger.localized('响应正文已省略', 'body omitted')}`);

    if (successful) XmaxLogger.api.debug(message);
    else XmaxLogger.api.error(message);
  }

  /**
   * Logs transport and parsing failure using SDK codes without backend or fetch error content.
   *
   * @param method The HTTP request method.
   * @param path The request path relative to the API root.
   * @param duration The request duration, in milliseconds.
   * @param code The SDK or service error code for this operation.
   * @param status The HTTP response status.
   */
  static failure(
    method: string,
    path: string,
    duration: number,
    code: string,
    status: number | null,
  ): void {
    XmaxLogger.api.error(
      () =>
        `${method} ${this.path(path)} ${XmaxLogger.localized('请求失败', 'Request Failed')}\n` +
        `├─ ${XmaxLogger.localized('耗时：', 'Duration: ')}${duration} ms\n` +
        `├─ ${XmaxLogger.localized('状态：', 'Status: ')}${
          status ?? XmaxLogger.localized('不可用', 'unavailable')
        }\n` +
        `└─ ${XmaxLogger.localized('原因：', 'Reason: ')}${code}`,
    );
  }
}
