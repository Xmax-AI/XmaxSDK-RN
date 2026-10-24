//
//  RealtimeSessionConnection.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The room credentials and generation bot identity returned by the session service.
 */
export interface RealtimeSessionConnection {

  /**
   * The RTC room identifier supplied by the session service.
   */
  readonly roomID: string;

  /**
   * The RTC access token for the current room and user; must never be logged.
   */
  readonly token: string;

  /**
   * The RTC participant's string account.
   */
  readonly userID: string;

  /**
   * The expected result account; when omitted, results are not filtered by account.
   */
  readonly botName: string | null;
}
