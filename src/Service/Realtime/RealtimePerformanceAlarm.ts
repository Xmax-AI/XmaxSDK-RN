//
//  RealtimePerformanceAlarm.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from './RealtimeVideoFormat';

/**
 * The state of encoding performance constraints or recovery.
 */
export enum RealtimePerformanceStatus {

  /**
   * Encoding performance is constrained.
   */
  limited = 'Limited',

  /**
   * Encoding performance has recovered.
   */
  recovered = 'Recovered',
}

/**
 * The encoding performance state and recommended format; capture settings are not changed
 * automatically.
 */
export interface RealtimePerformanceAlarm {

  /**
   * The state of encoding performance constraints or recovery.
   */
  readonly status: RealtimePerformanceStatus;

  /**
   * The recommended encoding dimensions and frame rate.
   */
  readonly suggestedVideoFormat: RealtimeVideoFormat | null;
}
