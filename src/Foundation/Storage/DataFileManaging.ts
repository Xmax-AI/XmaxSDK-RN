//
//  DataFileManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * An interface for private temporary files containing encoded media data.
 */
export interface DataFileManaging {

  /**
   * Writes a snapshot of encoded media into an SDK-owned temporary file.
   *
   * @param data The encoded file bytes, copied before asynchronous file access.
   * @returns The private file URL; remove it after all consumers finish reading.
   */
  create(
    data: Uint8Array
  ): Promise<string>;

  /**
   * Removes only a temporary file created by this instance.
   *
   * @param fileURL The owned temporary file URL.
   */
  remove(
    fileURL: string
  ): Promise<void>;
}
