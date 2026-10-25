//
//  PermissionManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * An interface for SDK media permissions.
 */
export interface PermissionManaging {

  /**
   * Requests camera access if necessary and verifies authorization.
   */
  ensureCameraPermission(): Promise<void>;

  /**
   * Requests microphone access if necessary and verifies authorization.
   */
  ensureMicrophonePermission(): Promise<void>;
}
