//
//  StoredFile.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The remote location and metadata of an uploaded file.
 */
export interface StoredFile {

  /**
   * The remote file URL, or the safety service's approved URL for checked uploads.
   */
  readonly url: string;

  /**
   * The object key within the credential-authorized directory.
   */
  readonly objectKey: string;

  /**
   * The ETag returned by COS, or null if absent.
   */
  readonly etag: string | null;
}
