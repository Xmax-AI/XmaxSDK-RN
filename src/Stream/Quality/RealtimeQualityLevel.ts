//
//  RealtimeQualityLevel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Transport quality levels, ordered from highest to lowest quality. Manual changes preserve
 * the configured adaptation policy.
 */
export enum RealtimeQualityLevel {

  /**
   * The highest transport quality.
   */
  l1 = 1,

  /**
   * The default transport quality when adaptation has no valid history.
   */
  l2 = 2,

  /**
   * Reduced dimensions for constrained bandwidth.
   */
  l3 = 3,

  /**
   * Further reduced dimensions and uplink frame rate.
   */
  l4 = 4,

  /**
   * The lowest transport quality, prioritizing delivery continuity.
   */
  l5 = 5,
}
