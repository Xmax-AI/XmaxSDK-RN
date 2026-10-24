//
//  RealtimeNetworkQuality.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The connection quality reported by RTC.
 */
export enum RealtimeNetworkQualityLevel {

  /**
   * No valid quality measurement is available.
   */
  unknown = 'Unknown',

  /**
   * The network quality is excellent.
   */
  excellent = 'Excellent',

  /**
   * The network quality is good.
   */
  good = 'Good',

  /**
   * The network quality is fair.
   */
  poor = 'Poor',

  /**
   * The network quality is poor; consecutive samples may trigger a lower encoding level.
   */
  bad = 'Bad',

  /**
   * The network quality is very poor; consecutive samples may trigger a lower encoding level.
   */
  veryBad = 'VeryBad',

  /**
   * The network connection is unavailable.
   */
  down = 'Down',
}

/**
 * A snapshot of RTC uplink and downlink network quality.
 */
export interface RealtimeNetworkQuality {

  /**
   * The uplink connection quality.
   */
  readonly uplink: RealtimeNetworkQualityLevel;

  /**
   * The downlink connection quality.
   */
  readonly downlink: RealtimeNetworkQualityLevel;
}
