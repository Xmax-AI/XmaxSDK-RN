//
//  XmaxLoggerOption.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Log categories that can be combined with bitwise OR.
 */
export enum XmaxLoggerOption {

  /**
   * Lifecycle, request, and business-operation logs.
   */
  business = 1,

  /**
   * Video statistics and encoder performance logs.
   */
  performance = 2,

  /**
   * All log categories.
   */
  all = 3,
}
