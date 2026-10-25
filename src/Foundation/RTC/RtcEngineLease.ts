//
//  RtcEngineLease.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcPlatform } from './RtcPlatform';

/**
 * Exclusive ownership of the process-wide RTC engine.
 */
export interface RtcEngineLease {

  /**
   * The unique ownership identity checked by native media operations.
   */
  readonly id: string;

  /**
   * The leased platform engine.
   */
  readonly engine: RtcPlatform;
}
