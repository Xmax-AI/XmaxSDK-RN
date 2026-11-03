//
//  XmaxCreditBalance.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The server-reported credit balance for the account owning the client's API key.
 */
export interface XmaxCreditBalance {

  /**
   * Remaining credits as a finite, nonnegative value, including fractional credits.
   */
  readonly currentBalance: number;
}
