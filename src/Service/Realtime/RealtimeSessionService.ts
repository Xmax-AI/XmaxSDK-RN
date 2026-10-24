//
//  RealtimeSessionService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeSessionServicing } from './RealtimeSessionServicing';
import type { RealtimeSession } from './RealtimeSession';
import type { ApiServicing } from '../Network/ApiServicing';
import { record, nonEmpty } from '../Network/ApiResponse';
import { XmaxError, XmaxErrorCode } from '../../Foundation/Errors/XmaxError';

/**
 * Manages session creation, heartbeat, and closure.
 */
export class RealtimeSessionService implements RealtimeSessionServicing {

  /**
   * Creates a session service using an authenticated API client.
   */
  constructor(
    /**
     * The authenticated HTTP request interface.
     */
    private readonly api: ApiServicing,
  ) {}

  /**
   * Creates and validates a session for the current model. If its RTC information is invalid,
   * closes the allocated session before rejecting.
   *
   * @param model The generation model defining media constraints and supported formats.
   * @param signal The operation's cancellation signal.
   * @returns The validated session and RTC connection credentials.
   */
  async createSession(
    model: string,
    signal?: AbortSignal,
  ): Promise<RealtimeSession> {
    const value = record(
      await this.api.request(
        'POST',
        '/session',
        { model },
        signal
      ),
    );
    const id = nonEmpty(value?.sessionUid);
    let extra: unknown = value?.modelExtra;

    try {
      if (typeof extra === 'string') extra = JSON.parse(extra);
    } catch {
      extra = null;
    }

    const connection = record(extra);
    const roomID = nonEmpty(connection?.room_id),
      token = nonEmpty(connection?.room_token),
      userID = nonEmpty(connection?.user_id) ?? nonEmpty(value?.userUid);

    if (!id || !roomID || !token || !userID) {
      // Invalid connection information may still include an allocated billable session that must be released.
      if (id) await this.closeSession(id).catch(() => {});

      throw new XmaxError({
        code: XmaxErrorCode.sessionError,
        message: 'Session does not contain complete RTC join information',
      });
    }

    return {
      id,
      connection: {
        roomID,
        token,
        userID,
        botName: nonEmpty(connection?.bot_name),
      },
    };
  }

  /**
   * Refreshes the specified session without changing generation conditions.
   *
   * Completes after the server acknowledges the session heartbeat.
   *
   * @param sessionID The server identifier returned when the session was created.
   * @param signal The operation's cancellation signal.
   */
  async heartbeat(
    sessionID: string,
    signal?: AbortSignal
  ): Promise<void> {
    const data = record(
      await this.api.request(
        'PUT',
        `/session/${encodeURIComponent(sessionID)}/heartbeat`,
        undefined,
        signal,
      ),
    );

    if (
      nonEmpty(data?.sessionUid) !== sessionID ||
      (nonEmpty(data?.status) && data?.status !== 'ACTIVE')
    )
      throw new XmaxError({
        code: XmaxErrorCode.sessionError,
        message: nonEmpty(data?.closeReason) ?? 'Session is no longer active',
      });
  }

  /**
   * Requests closure of the specified session without affecting local capture.
   *
   * Completes when the session closure request finishes.
   *
   * @param sessionID The server identifier returned when the session was created.
   */
  async closeSession(
    sessionID: string
  ): Promise<void> {
    await this.api.request(
      'DELETE',
      `/session/${encodeURIComponent(sessionID)}`,
    );
  }
}
