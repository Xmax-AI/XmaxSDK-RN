//
//  StorageProgress.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Byte-based transfer progress. Total size and fraction are null when the total is unknown.
 */
export interface StorageProgress {

  /**
   * The number of bytes transferred.
   */
  readonly completedUnitCount: number;

  /**
   * The total number of bytes.
   */
  readonly totalUnitCount: number | null;

  /**
   * The completed fraction, from 0 to 1.
   */
  readonly fractionCompleted: number | null;
}
