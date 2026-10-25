//
//  StorageLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { MediaSize } from '../Realtime/RealtimeVideoFormat';

/**
 * Formats safe transfer metadata without credentials, source paths, or signed URLs.
 */
export class StorageLogger {

  /**
   * Logs media type, display dimensions, encoded byte count, and safety-check selection.
   *
   * @param media The uploaded media category.
   * @param size The display dimensions; null is reported as unavailable.
   * @param byteCount The encoded file size, in bytes.
   * @param checksSafety Whether the upload includes image safety validation.
   */
  static uploadStarted(
    media: 'image' | 'video',
    size: MediaSize | null,
    byteCount: number,
    checksSafety: boolean,
  ): void {
    XmaxLogger.storage.info(() =>
      [
        '开始上传 (Upload Started)',
        `├─ ${XmaxLogger.localized('类型：', 'Type: ')}${media}`,
        `├─ ${XmaxLogger.localized('分辨率：', 'Resolution: ')}${
          size ? `${size.width}x${size.height}` : '--'
        }`,
        `├─ ${XmaxLogger.localized('大小：', 'Size: ')}${this.formatByteCount(byteCount)}`,
        `└─ ${XmaxLogger.localized('安全检测：', 'Safety Check: ')}${checksSafety}`,
      ].join('\n'),
    );
  }

  /**
   * Formats an encoded file size in bytes, KB, MB, or GB.
   *
   * @param value The nonnegative byte count.
   * @returns The formatted size, or -- when the count is unavailable.
   */
  private static formatByteCount(
    value: number
  ): string {
    if (!Number.isFinite(value) || value < 0) return '--';
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(2)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }

  /**
   * Formats elapsed transfer time in milliseconds or seconds.
   *
   * @param milliseconds The elapsed duration in milliseconds.
   * @returns The formatted duration.
   */
  static formatDuration(
    milliseconds: number
  ): string {
    return milliseconds < 1000
      ? `${Math.floor(milliseconds)} ms`
      : `${(milliseconds / 1000).toFixed(2)} s`;
  }
}
