//
//  XmaxError.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Stable SDK error codes used by synchronous exceptions and asynchronous failures.
 */
export enum XmaxErrorCode {

  /**
   * The API key is missing or rejected by the service.
   */
  invalidAPIKey = 'INVALID_API_KEY',

  /**
   * Configuration, media format, or parameters are invalid.
   */
  invalidConfiguration = 'INVALID_CONFIGURATION',

  /**
   * An internal failure without a more specific classification.
   */
  internalError = 'INTERNAL_ERROR',

  /**
   * A request failed before a valid service response arrived.
   */
  networkError = 'NETWORK_ERROR',

  /**
   * The service rejected the request or returned an invalid response.
   */
  apiError = 'API_ERROR',

  /**
   * Session creation or lifecycle data is invalid.
   */
  sessionError = 'SESSION_ERROR',

  /**
   * An RTC engine, room, signaling, or canvas operation failed.
   */
  rtcError = 'RTC_ERROR',

  /**
   * Local media preparation, capture, or frame submission failed.
   */
  mediaError = 'MEDIA_ERROR',

  /**
   * Camera permission is denied or restricted.
   */
  cameraPermissionDenied = 'CAMERA_PERMISSION_DENIED',

  /**
   * Microphone permission is denied or restricted.
   */
  microphonePermissionDenied = 'MICROPHONE_PERMISSION_DENIED',

  /**
   * Your app or the manager lifecycle cancelled the operation.
   */
  cancelled = 'CANCELLED',

  /**
   * The operation exceeded its wait limit.
   */
  timeout = 'TIMEOUT',

  /**
   * File upload failed.
   */
  uploadError = 'UPLOAD_ERROR',

  /**
   * Download or destination replacement failed.
   */
  downloadError = 'DOWNLOAD_ERROR',

  /**
   * The image did not pass its safety check.
   */
  unsafeImage = 'UNSAFE_IMAGE',
}

/**
 * An SDK error with a stable code and available service response metadata.
 *
 * Use XmaxError.from() to normalize native or unknown errors.
 */
export class XmaxError extends Error {

  /**
   * The SDK error name.
   */
  readonly name = 'XmaxError';

  /**
   * The stable SDK error code.
   */
  readonly code: XmaxErrorCode;

  /**
   * The service business response code.
   */
  readonly apiCode: number | null;

  /**
   * The HTTP response status code.
   */
  readonly httpStatus: number | null;

  /**
   * Creates an SDK error with a code, message, and response metadata.
   *
   * @param options The SDK code, message, service code, and HTTP status.
   */
  constructor(
    options: {

      /**
       * The SDK code used for programmatic error handling.
       */
      code: XmaxErrorCode;

      /**
       * The human-readable description; use the error code for program logic.
       */
      message: string;

      /**
       * The service business response code.
       */
      apiCode?: number | null;

      /**
       * The HTTP response status code.
       */
      httpStatus?: number | null;
    }
  ) {
    super(options.message);
    this.code = options.code;
    this.apiCode = options.apiCode ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }

  /**
   * Preserves existing SDK errors and recognized native codes; unknown platform errors become
   * INTERNAL_ERROR.
   *
   * @param error The failure reported by the operation.
   */
  static from(
    error: unknown
  ): XmaxError {
    if (error instanceof XmaxError) return error;

    const details =
      typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>)
        : null;
    const code = Object.values(XmaxErrorCode).find(
      value => value === details?.code,
    );

    return new XmaxError({
      code: code ?? XmaxErrorCode.internalError,
      message:
        typeof details?.message === 'string' ? details.message : String(error),
      ...(code && {
        apiCode: numericMetadata(details?.apiCode),
        httpStatus: numericMetadata(details?.httpStatus),
      }),
    });
  }
}

/**
 * Normalizes optional numeric response metadata.
 *
 * @param value The server numeric metadata to validate.
 * @returns The safe integer value, or null when absent or invalid.
 */
function numericMetadata(
  value: unknown
): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

/**
 * Creates an INVALID_CONFIGURATION error for unsupported or malformed parameters.
 *
 * @param message The error description.
 */
export function invalid(
  message: string
): XmaxError {
  return new XmaxError({ code: XmaxErrorCode.invalidConfiguration, message });
}

/**
 * Creates a CANCELLED error for interrupted realtime work.
 */
export function cancelledError(): XmaxError {
  return new XmaxError({
    code: XmaxErrorCode.cancelled,
    message: 'Realtime operation was cancelled',
  });
}
