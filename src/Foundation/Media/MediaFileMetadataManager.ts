//
//  MediaFileMetadataManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaFileMetadataManaging } from './MediaFileMetadataManaging';
import type { MediaSize } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * Reads native image and video file dimensions without acquiring capture or RTC resources.
 */
export class MediaFileMetadataManager implements MediaFileMetadataManaging {

  /**
   * Creates a media metadata reader without accessing native resources.
   */
  constructor(
    /**
     * The encoded-file metadata reader returning serialized display dimensions.
     *
     * @param fileURL The readable local file URL.
     * @param media The encoded image or video category.
     * @returns Serialized orientation-corrected display dimensions.
     */
    private readonly readInfo: (
      fileURL: string,
      media: 'image' | 'video',
    ) => Promise<string> = (fileURL, media) => {
      const runtime = require('../Native/NativeXmaxRuntime').default;
      return media === 'image'
        ? runtime.imageInfo(fileURL)
        : runtime.videoInfo(fileURL);
    },
  ) {}

  /**
   * Reads orientation-corrected display dimensions without transferring decoded pixels.
   *
   * @param fileURL The readable local file URL.
   * @param media The encoded image or video category.
   * @returns The valid integer display dimensions, or null if metadata lacks valid dimensions.
   */
  async readMetadata(
    fileURL: string,
    media: 'image' | 'video',
  ): Promise<MediaSize | null> {
    const size: MediaSize = JSON.parse(await this.readInfo(
      fileURL,
      media
    ));
    if (
      !size ||
      ![size.width, size.height].every(
        value => Number.isSafeInteger(value) && value > 0,
      )
    )
      return null;
    return { width: size.width, height: size.height };
  }
}
