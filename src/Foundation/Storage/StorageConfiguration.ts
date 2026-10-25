//
//  StorageConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { StorageCredential } from './StorageCredential';

/**
 * The validated COS endpoint, directory, and temporary credentials for an upload.
 */
export interface StorageConfiguration {

  /**
   * The COS bucket authorized for this transfer.
   */
  readonly bucket: string;

  /**
   * The destination COS bucket region.
   */
  readonly region: string;

  /**
   * The credential service endpoint; an empty string uses the regional COS endpoint.
   */
  readonly endpoint: string;

  /**
   * The authorized object-key prefix.
   */
  readonly prefix: string;

  /**
   * The transfer-specific temporary COS credentials; never log them.
   */
  readonly credential: StorageCredential;
}
