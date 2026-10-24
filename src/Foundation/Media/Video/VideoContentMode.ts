//
//  VideoContentMode.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The aspect-preserving scaling mode for video inside its view.
 */
export enum VideoContentMode {

  /**
   * Fills the view and crops content outside its bounds.
   */
  fill = 'fill',

  /**
   * Displays the complete frame with space around it when needed.
   */
  fit = 'fit',
}
