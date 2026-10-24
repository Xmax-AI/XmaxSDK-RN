//
//  EncodingControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeTypes';

/**
 * An interface for applying RTC video encoding settings.
 */
export interface EncodingControlling {

  /**
   * Validates and applies encoding. An unspecified minimum uses 500 kbps, capped by the maximum.
   *
   * @param format The dimensions, frame rate, optional bitrate bounds, and encoder preference.
   */
  configure(
    format: RealtimeVideoFormat
  ): Promise<void>;
}
