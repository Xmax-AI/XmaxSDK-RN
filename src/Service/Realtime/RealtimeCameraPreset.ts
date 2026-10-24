//
//  RealtimeCameraPreset.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A camera resolution preset whose availability depends on the selected model.
 *
 * Use the model's supportedVideoFormats for available dimensions. A supported format need not
 * have a corresponding preset case.
 */
export enum RealtimeCameraPreset {

  /**
   * A landscape 16:9 frame.
   */
  resolution1920x1080 = '1920x1080',

  /**
   * A portrait 9:16 frame.
   */
  resolution1080x1920 = '1080x1920',

  /**
   * A square frame.
   */
  resolution1408x1408 = '1408x1408',

  /**
   * A portrait 3:4 frame.
   */
  resolution1152x1536 = '1152x1536',

  /**
   * A landscape 4:3 frame.
   */
  resolution1536x1152 = '1536x1152',
}
