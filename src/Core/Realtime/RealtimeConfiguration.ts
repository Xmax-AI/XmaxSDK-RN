//
//  RealtimeConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeModel } from '../../Service/Realtime/RealtimeModel';

/**
 * The model and transport quality configuration used to create a realtime manager.
 */
export interface RealtimeConfiguration {

  /**
   * The model that determines media constraints and generation capabilities.
   */
  readonly model: RealtimeModel;

  /**
   * Whether to adapt transport quality automatically; defaults to true. Disabled connections start
   * at L1 without reading or writing quality history. Manual quality changes remain available.
   */
  readonly isAdaptiveQualityEnabled?: boolean;
}
