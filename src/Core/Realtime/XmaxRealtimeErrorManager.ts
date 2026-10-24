//
//  XmaxRealtimeErrorManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError } from '../../Foundation/Errors/XmaxError';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { TerminationScope } from './XmaxRealtimeLifecycleManager';

/**
 * A handler that terminates resources affected by a current runtime failure.
 *
 * @param error The normalized SDK failure.
 * @param target The resources affected by the failure.
 * @param isCurrent The check that rejects failures from a released lifecycle.
 */
export type RealtimeFailureHandler = (
  error: XmaxError,
  target: TerminationScope,
  isCurrent: () => boolean,
) => void;

/**
 * Logs realtime errors and forwards runtime failures for coordinated lifecycle termination.
 */
export class XmaxRealtimeErrorManager {

  /**
   * The revision rejecting failures from released media resources.
   */
  private mediaRevision = 0;

  /**
   * The revision rejecting failures from released connections.
   */
  private connectionRevision = 0;

  /**
   * The handler forwarding current failures to lifecycle termination.
   */
  private failureHandler: RealtimeFailureHandler | null = null;

  /**
   * Sets the runtime failure handler.
   *
   * @param handler The handler receiving the failure, cleanup scope, and validity check.
   */
  setFailureHandler(
    handler: RealtimeFailureHandler
  ): void {
    this.failureHandler = handler;
  }

  /**
   * Invalidates pending failures for resources that have finished cleanup.
   *
   * @param target The released scope; full cleanup invalidates both media and connection failures.
   */
  invalidatePendingFailures(
    target: TerminationScope = 'all'
  ): void {
    this.connectionRevision++;
    if (target === 'all') this.mediaRevision++;
  }

  /**
   * Forwards a normalized runtime failure or logs it when no handler or scope is supplied.
   *
   * @param error The operation or runtime failure.
   * @param target The affected resources; omission logs without terminating the lifecycle.
   */
  forward(
    error: unknown,
    target?: TerminationScope
  ): void {
    const failure = XmaxError.from(error);
    const revision =
      target === 'all' ? this.mediaRevision : this.connectionRevision;
    const handler = this.failureHandler;
    if (!target || !handler) {
      this.report(failure);
      return;
    }

    handler(
      failure,
      target,
      () =>
        (target === 'all' ? this.mediaRevision : this.connectionRevision) ===
        revision,
    );
  }

  /**
   * Logs an SDK error code without exposing native messages or service payloads.
   *
   * @param error The failure to normalize and report.
   * @param context The static operation label used to identify the failure.
   */
  report(
    error: unknown,
    context = 'Realtime service error'
  ): void {
    const failure = XmaxError.from(error);
    XmaxLogger.realtime.error(() => `${context}: ${failure.code}`);
  }
}
