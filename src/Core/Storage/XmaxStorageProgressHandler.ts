//
//  XmaxStorageProgressHandler.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { StorageProgress } from './StorageProgress';

/**
 * A transfer progress handler whose exceptions do not interrupt the transfer.
 *
 * @param progress The current transfer progress.
 */
export type XmaxStorageProgressHandler = (
  progress: StorageProgress
) => void;
