//
//  RealtimeMediaSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The local input source; image aspect ratio is independent of the generation canvas.
 */
export enum RealtimeMediaSource {

  /**
   * Local camera input.
   */
  camera = 'camera',

  /**
   * Local image input delivered as repeated, orientation-corrected video frames.
   */
  image = 'image',
}
