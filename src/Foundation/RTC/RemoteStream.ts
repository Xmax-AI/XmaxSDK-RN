//
//  RemoteStream.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A remote stream identified by room and string account rather than numeric UID.
 */
export type RemoteStream = {

  /**
   * The RTC room identifier supplied by the session service.
   */
  roomID: string;

  /**
   * The RTC participant's string account.
   */
  userID: string;
};
