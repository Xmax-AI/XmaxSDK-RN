//
//  EncodingController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { EncodingControlling } from './EncodingControlling';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeTypes';
import { resolveBitrates } from './EncodingBitratePolicy';

/**
 * Applies RTC encoding settings for a realtime video format.
 */
export class EncodingController implements EncodingControlling {

  /**
   * Creates a video encoding controller.
   */
  constructor(
    /**
     * The RTC encoder configuration target.
     */
    private readonly rtc: RtcManaging,
  ) {}

  /**
   * Validates and applies encoding. An unspecified minimum uses 500 kbps, capped by the maximum.
   *
   * @param format The dimensions, frame rate, optional bitrate bounds, and encoder preference.
   */
  async configure(
    format: RealtimeVideoFormat
  ): Promise<void> {
    const budget = EncodingController.bitrates(format);
    await this.rtc.configureEncoding(
      format,
      budget.minimum,
      budget.maximum
    );
  }

  /**
   * Resolves applied uplink bitrate bounds while preserving an explicit zero minimum.
   *
   * @param format The dimensions, frame rate, optional bitrate bounds, and encoder preference.
   * @returns The uplink minimum and maximum bitrates, in kbps.
   */
  static bitrates(
    format: RealtimeVideoFormat,
  ): ReturnType<typeof resolveBitrates> {
    const budget = resolveBitrates(format);
    return {
      minimum: format.minimumBitrate ?? Math.min(500, budget.maximum),
      maximum: budget.maximum,
    };
  }
}
