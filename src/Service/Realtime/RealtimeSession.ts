//
//  RealtimeSession.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeSessionConnection } from './RealtimeSessionConnection';

/**
 * The server session identifier and validated RTC connection information.
 */
export interface RealtimeSession {

  /**
   * The session identifier allocated by the realtime session service.
   */
  readonly id: string;

  /**
   * The active room connection and server session.
   */
  readonly connection: RealtimeSessionConnection;
}
