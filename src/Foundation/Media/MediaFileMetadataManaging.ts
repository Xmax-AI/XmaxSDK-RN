//
//  MediaFileMetadataManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaSize } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * An interface for reading encoded media display dimensions without decoding frames into JS.
 */
export interface MediaFileMetadataManaging {

  /**
   * Reads the orientation-corrected dimensions of an encoded local media file.
   *
   * @param fileURL The readable local file URL, retained by its owner while reading.
   * @param media The encoded image or video category.
   * @returns The display dimensions, or null when the file has no valid dimensions.
   */
  readMetadata(
    fileURL: string,
    media: 'image' | 'video',
  ): Promise<MediaSize | null>;
}
