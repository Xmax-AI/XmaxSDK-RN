//
//  RtcEngineManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcEngineLease } from './RtcEngineLease';
import type { RtcEngineManaging } from './RtcEngineManaging';
import type { RtcPlatform } from './RtcPlatform';
import { cancelledError, invalid } from '../Errors/XmaxError';
import { ensureActive } from '../Runtime/Async';

/**
 * A queued, cancellable request for exclusive engine ownership.
 */
interface Request {

  /**
   * The platform creating the next engine.
   */
  readonly platform: RtcPlatform;

  /**
   * The caller's cancellation signal.
   */
  readonly signal: AbortSignal;

  /**
   * The callback receiving the acquired lease.
   *
   * @param lease The acquired exclusive lease.
   */
  readonly resolve: (
    lease: RtcEngineLease
  ) => void;

  /**
   * The callback receiving acquisition failures.
   *
   * @param error The acquisition failure.
   */
  readonly reject: (
    error: unknown
  ) => void;

  /**
   * Removes the cancellation subscription when dequeued.
   */
  readonly detach: () => void;
}

/**
 * Serializes exclusive access to the process-wide RTC engine.
 * Pending requests are served in acquisition order and can be cancelled without acquiring media.
 */
export class RtcEngineManager implements RtcEngineManaging {

  /**
   * The process-wide lease manager.
   */
  static readonly shared = new RtcEngineManager();

  /**
   * The currently held exclusive lease.
   */
  private activeLease: RtcEngineLease | null = null;

  /**
   * Whether native ownership acquisition is in progress.
   */
  private acquiring = false;

  /**
   * The pending requests in acquisition order.
   */
  private requests: Request[] = [];

  /**
   * Waits for exclusive native media ownership.
   *
   * @param platform The platform used to acquire the engine.
   * @param signal The acquisition cancellation signal.
   * @returns The lease retained until release completes.
   */
  acquire(
    platform: RtcPlatform,
    signal: AbortSignal
  ): Promise<RtcEngineLease> {
    if (signal.aborted) return Promise.reject(cancelledError());
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.requests.indexOf(request);
        if (index < 0) return;
        this.requests.splice(
          index,
          1
        );
        request.detach();
        reject(cancelledError());
      };
      const request: Request = {
        platform,
        signal,
        resolve,
        reject,
        detach: () => signal.removeEventListener(
          'abort',
          abort
        ),
      };
      signal.addEventListener(
        'abort',
        abort,
        { once: true }
      );
      this.requests.push(request);
      void this.fulfillNextRequest();
    });
  }

  /**
   * Releases a lease after native engine destruction and serves the next waiter.
   *
   * @param lease The returned lease; stale releases cannot affect another owner.
   */
  release(
    lease: RtcEngineLease
  ): void {
    if (this.activeLease !== lease) return;
    lease.engine.release(lease.id);
    this.activeLease = null;
    void this.fulfillNextRequest();
  }

  /**
   * Creates one lease at a time while preserving request order across asynchronous preparation.
   */
  private async fulfillNextRequest(): Promise<void> {
    if (this.activeLease || this.acquiring) return;
    this.acquiring = true;
    try {
      while (!this.activeLease && this.requests.length) {
        const request = this.requests.shift()!;
        request.detach();
        let id: string | null = null;
        try {
          ensureActive(request.signal);
          await request.platform.prepareRuntime();
          ensureActive(request.signal);
          id = request.platform.randomUUID();
          if (!request.platform.acquire(id))
            throw invalid(
              'Native media ownership is unavailable while the app is backgrounded or another runtime owns the engine',
            );
          const lease = { id, engine: request.platform };
          if (request.signal.aborted) {
            request.platform.release(id);
            id = null;
            throw cancelledError();
          }
          this.activeLease = lease;
          request.resolve(lease);
        } catch (error) {
          request.reject(error);
        }
      }
    } finally {
      this.acquiring = false;
    }
  }
}
