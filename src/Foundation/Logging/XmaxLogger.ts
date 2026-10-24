//
//  XmaxLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLoggerOption } from './XmaxLoggerOption';

/**
 * Receives formatted, credential-free logs while retaining severity.
 *
 * @param level The log severity: debug, info, warn, or error.
 * @param message The formatted log message.
 * @param option The current message's log-category bitmask.
 */
export type LogSink = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  option: XmaxLoggerOption,
) => void;

/**
 * The log text or lazy producer, evaluated only when its category is enabled.
 */
type Message = string | (() => string);

/**
 * A global category logger with lazy message production. The latest client determines filtering and
 * output. Never log credentials, prompts, signed URLs, or raw responses.
 */
export class XmaxLogger {

  /**
   * The realtime lifecycle logger.
   */
  static readonly realtime = new XmaxLogger('Realtime');

  /**
   * The logger for RTC ownership, transport, and video statistics.
   */
  static readonly rtc = new XmaxLogger('RTC');

  /**
   * The local media preparation and release logger.
   */
  static readonly media = new XmaxLogger('Media');

  /**
   * The service request metadata logger.
   */
  static readonly api = new XmaxLogger('API');

  /**
   * The file transfer logger.
   */
  static readonly storage = new XmaxLogger('Storage');

  /**
   * The room connection and generation signaling logger.
   */
  static readonly room = new XmaxLogger('Room');

  /**
   * The generation task and transport-policy logger.
   */
  static readonly stream = new XmaxLogger('Stream');

  /**
   * The canvas binding and remote display logger.
   */
  static readonly render = new XmaxLogger('Render');

  /**
   * The interaction submission and custom trajectory callback logger.
   */
  static readonly interaction = new XmaxLogger('Interaction');

  /**
   * The media permission logger.
   */
  static readonly permission = new XmaxLogger('Permission');

  /**
   * The global category bitmask; 0 disables logging.
   */
  private static options = 0;

  /**
   * The language used for log details, independent of service routing.
   */
  private static language: 'chinese' | 'english' = 'chinese';

  /**
   * The output function for enabled, formatted logs.
   */
  private static sink: LogSink = () => {};

  /**
   * Creates a category logger sharing global filtering and output.
   */
  private constructor(
    /**
     * The category name attached to messages.
     */
    private readonly category: string,
  ) {}

  /**
   * Replaces global filtering and output for existing and future services.
   *
   * @param options The SDK log-category bitmask; 0 disables logging.
   * @param sink The formatted log output function.
   * @param language The language of log details; defaults to Chinese.
   */
  static configure(
    options: number,
    sink: LogSink,
    language: 'chinese' | 'english' = 'chinese',
  ): void {
    this.options = options;
    this.sink = sink;
    this.language = language;
  }

  /**
   * Selects log detail text using the current global language.
   *
   * @param chinese The Chinese log text.
   * @param english The English log text.
   * @returns The text for the configured language.
   */
  static localized(
    chinese: string,
    english: string
  ): string {
    return this.language === 'chinese' ? chinese : english;
  }

  /**
   * Checks category flags without producing message text or invoking native code.
   *
   * @param option The current message's log-category bitmask.
   * @returns Whether every requested category flag is enabled.
   */
  static isEnabled(
    option: number
  ): boolean {
    // eslint-disable-next-line no-bitwise
    return option !== 0 && (this.options & option) === option;
  }

  /**
   * Logs diagnostic details using the business category by default.
   *
   * @param message The log text or lazy message producer.
   * @param option The message category bitmask; defaults to the business category.
   */
  debug(
    message: Message,
    option = XmaxLoggerOption.business
  ): void {
    this.write(
      'debug',
      message,
      option
    );
  }

  /**
   * Logs a lifecycle or business event.
   *
   * @param message The log text or lazy message producer.
   * @param option The message category bitmask; defaults to the business category.
   */
  info(
    message: Message,
    option = XmaxLoggerOption.business
  ): void {
    this.write(
      'info',
      message,
      option
    );
  }

  /**
   * Logs a recoverable issue or app callback failure.
   *
   * @param message The log text or lazy message producer.
   * @param option The message category bitmask; defaults to the business category.
   */
  warn(
    message: Message,
    option = XmaxLoggerOption.business
  ): void {
    this.write(
      'warn',
      message,
      option
    );
  }

  /**
   * Logs an operation failure without changing error propagation.
   *
   * @param message The log text or lazy message producer.
   * @param option The message category bitmask; defaults to the business category.
   */
  error(
    message: Message,
    option = XmaxLoggerOption.business
  ): void {
    this.write(
      'error',
      message,
      option
    );
  }

  /**
   * Formats and delivers enabled messages without propagating logging failures.
   *
   * @param level The log severity.
   * @param message The log text or lazy message producer.
   * @param option The current message's log-category bitmask.
   */
  private write(
    level: Parameters<LogSink>[0],
    message: Message,
    option: XmaxLoggerOption,
  ): void {
    if (!XmaxLogger.isEnabled(option)) return;

    // Logging and native output failures must not interrupt SDK operations.
    try {
      const text = typeof message === 'function' ? message() : message;
      const formatted = text
        .split(/\r?\n/)
        .map(line => `[Xmax][${this.category}] ${line}`)
        .join('\n');
      XmaxLogger.sink(
        level,
        formatted,
        option
      );
    } catch {
      /**
       * Avoid recursive console fallback that bypasses category and privacy controls.
       */
    }
  }
}
