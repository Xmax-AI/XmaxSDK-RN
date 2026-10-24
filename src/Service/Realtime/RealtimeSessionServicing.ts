//
//  RealtimeSessionServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeSession } from './RealtimeSession';

/**
 * An interface for creating, refreshing, and closing realtime sessions.
 */
export interface RealtimeSessionServicing {

  /**
   * Creates and validates a session for the current model. If its RTC information is invalid,
   * closes the allocated session before rejecting.
   *
   * @param model The generation model defining media constraints and supported formats.
   * @param signal The operation's cancellation signal.
   * @returns The validated session and RTC connection credentials.
   */
  createSession(
    model: string,
    signal?: AbortSignal
  ): Promise<RealtimeSession>;

  /**
   * Refreshes the specified session without changing generation conditions.
   *
   * Completes after the server acknowledges the session heartbeat.
   *
   * @param sessionID The server identifier returned when the session was created.
   * @param signal The operation's cancellation signal.
   */
  heartbeat(
    sessionID: string,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Requests closure of the specified session without affecting local capture.
   *
   * Completes when the session closure request finishes.
   *
   * @param sessionID The server identifier returned when the session was created.
   */
  closeSession(
    sessionID: string
  ): Promise<void>;
}
