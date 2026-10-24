//
//  ApiService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { ApiLogger } from './ApiLogger';
import { requestHTTP, type HttpTransport } from './HttpTransport';
import { XmaxError, XmaxErrorCode } from '../../Foundation/Errors/XmaxError';
import type { RuntimeInfo } from '../../Foundation/Runtime/RuntimeInfo';

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

/**
 * The internal JSON request interface shared by realtime and storage services.
 */
export interface ApiServicing {

  /**
   * Requests data from an API root and propagates cancellation to transport. A response that wins
   * cancellation remains available for resource reclamation.
   *
   * @param method The HTTP request method.
   * @param path The request path relative to the API root.
   * @param body The JSON-serializable request body; omitted for requests without a payload.
   * @param signal The operation's cancellation signal.
   * @returns The business data after transport and response validation.
   */
  request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

/**
 * Sends Xmax API requests and handles responses, logging, and errors.
 */
export class ApiService implements ApiServicing {

  /**
   * Creates a JSON service with authentication, runtime metadata, timeout, and cancellation
   * handling.
   */
  constructor(
    /**
     * The API key used for requests; never log it.
     */
    private readonly apiKey: string,

    /**
     * The absolute service API root without a trailing slash.
     */
    private readonly baseURL: string,

    /**
     * The platform, system, device, and SDK version metadata.
     */
    private readonly runtime: RuntimeInfo,

    /**
     * The cancellable HTTP transport function.
     */
    private readonly transport: HttpTransport = requestHTTP,
  ) {}

  /**
   * Sends authenticated JSON and resolves business data while distinguishing cancellation, timeout,
   * and service failure.
   *
   * @param method The HTTP request method.
   * @param path The request path relative to the API root.
   * @param body The JSON-serializable request body; omitted for requests without a payload.
   * @param signal The operation's cancellation signal.
   * @returns The response data; rejects authentication, cancellation, timeout, or request failures.
   */
  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.apiKey)
      throw new XmaxError({
        code: XmaxErrorCode.invalidAPIKey,
        message: 'API key cannot be empty',
      });

    const started = Date.now();
    let responseLogged = false;
    let status: number | null = null;
    const controller = new AbortController();
    let abortCause: 'cancelled' | 'timeout' | null = null;
    const abort = (cause: 'cancelled' | 'timeout') => {
      if (abortCause) return;

      abortCause = cause;
      controller.abort();
    };
    const cancel = () => abort('cancelled');
    signal?.addEventListener(
      'abort',
      cancel,
      { once: true }
    );
    if (signal?.aborted) cancel();
    const timer = setTimeout(
      () => abort('timeout'),
      15000
    );

    try {
      if (controller.signal.aborted) throw new Error('Request aborted');

      const response = await this.transport(
        `${this.baseURL}${path}`,
        {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
            'X-Platform': this.runtime.platform,
            'X-OS-Version': this.runtime.os_version,
            'X-SDK-Version': this.runtime.sdk_version,
            'X-Device-Model': this.runtime.device_model,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        }
      );
      status = response.status;
      const text = await response.text();
      let value: unknown;

      try {
        value = JSON.parse(text);
      } catch {
        throw new XmaxError({
          code: XmaxErrorCode.apiError,
          message: 'Server returned invalid JSON',
          httpStatus: response.status,
        });
      }

      const envelope = record(value);
      const successful =
        response.ok && envelope?.success === true && envelope.data != null;
      ApiLogger.response(
        method,
        path,
        response.status,
        ApiLogger.byteLength(text),
        Date.now() - started,
        successful,
        envelope?.code,
      );
      responseLogged = true;

      if (!response.ok || envelope?.success !== true)
        throw new XmaxError({
          code: XmaxErrorCode.apiError,
          message: nonEmpty(envelope?.message) ?? 'Xmax API request failed',
          httpStatus: response.status,
          apiCode: typeof envelope?.code === 'number' ? envelope.code : null,
        });
      if (envelope.data === undefined || envelope.data === null)
        throw new XmaxError({
          code: XmaxErrorCode.apiError,
          message: 'Server returned no data',
          httpStatus: response.status,
        });

      return envelope.data;
    } catch (error) {
      const failure = transportError(
        error,
        abortCause
      );
      if (!responseLogged)
        ApiLogger.failure(
          method,
          path,
          Date.now() - started,
          failure.code,
          status,
        );
      throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener(
        'abort',
        cancel
      );
    }
  }
}

/**
 * Distinguishes caller cancellation from HTTP timeout while preserving transport errors.
 *
 * @param error The failure reported by the operation.
 * @param abortCause Whether abortion originated from caller cancellation or request timeout.
 */
function transportError(
  error: unknown,
  abortCause: 'cancelled' | 'timeout' | null,
): XmaxError {
  const details = record(error);
  if (
    abortCause === 'cancelled' ||
    (abortCause === null &&
      (details?.name === 'AbortError' || details?.code === 'ABORT_ERR'))
  )
    return new XmaxError({
      code: XmaxErrorCode.cancelled,
      message: 'API request was cancelled',
    });
  if (abortCause === null && error instanceof XmaxError) return error;

  const message =
    abortCause === 'timeout'
      ? 'API request timed out'
      : nonEmpty(details?.message) ??
        nonEmpty(error) ??
        'Network request failed';
  const platformCode = details?.code;
  const suffix =
    abortCause === null &&
    ((typeof platformCode === 'number' && Number.isFinite(platformCode)) ||
      (typeof platformCode === 'string' && platformCode.trim()))
      ? `（平台错误码：${platformCode}）`
      : '';

  return new XmaxError({
    /**
     * HTTP timeouts are network failures; RTC confirmation deadlines use TIMEOUT.
     */
    code: XmaxErrorCode.networkError,
    message: `HTTP request failed: ${message}${suffix}`,
  });
}
