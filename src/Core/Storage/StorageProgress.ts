//
//  StorageProgress.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { StorageProgress as TransferValue } from '../../Foundation/Storage/StorageProgress';

/**
 * Byte-based transfer progress. Total size and fraction are null when the total is unknown.
 */
export type StorageProgress = TransferValue;
