//
//  StorageCredential.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The transfer-specific temporary credentials authorizing one upload.
 */
export interface StorageCredential {

  /**
   * The temporary access key identifier.
   */
  readonly accessKeyID: string;

  /**
   * The temporary secret access key; never log or disclose it.
   */
  readonly secretAccessKey: string;

  /**
   * The temporary session token authorizing the transfer; never log it.
   */
  readonly sessionToken: string;
}
