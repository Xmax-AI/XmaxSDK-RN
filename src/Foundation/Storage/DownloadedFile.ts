//
//  DownloadedFile.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The location and size of a downloaded file.
 */
export interface DownloadedFile {

  /**
   * The destination file URL supplied by your app.
   */
  readonly fileURL: string;

  /**
   * The number of saved bytes.
   */
  readonly byteCount: number;
}
