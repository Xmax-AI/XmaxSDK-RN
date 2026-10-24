//
//  RealtimeContext.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The prompt and reference image for a generation task.
 */
export interface RealtimeContext {

  /**
   * The generation prompt; leading and trailing whitespace is removed before submission.
   */
  readonly prompt: string;

  /**
   * The remote reference image path. A blank, null, or omitted value in new conditions clears the
   * reference image.
   */
  readonly referencePath?: string | null;
}
