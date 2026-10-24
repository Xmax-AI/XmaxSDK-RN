//
//  Async.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { cancelledError, XmaxError, XmaxErrorCode } from '../Errors/XmaxError';

/**
 * Throws CANCELLED when the signal is aborted.
 *
 * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
 */
export function ensureActive(
  signal: AbortSignal
): void {
  if (signal.aborted) throw cancelledError();
}

/**
 * Waits for subscribed events with timeout and cancellation, removing subscriptions on every exit
 * path.
 *
 * @param subscribe Registers success and failure handlers and returns an unsubscribe function.
 * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
 * @param milliseconds The maximum wait, in milliseconds.
 * @param label The operation name used in timeout errors; exclude credentials and user content.
 */
export function waitFor<T>(
  subscribe: (
    resolve: (
      value: T
    ) => void,
    reject: (
      error: unknown
    ) => void,
  ) => () => void,
  signal: AbortSignal,
  milliseconds: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledError());
      return;
    }

    let done = false;
    let unsubscribe = () => {};
    const finish = (error: unknown, value?: T) => {
      if (done) return;

      done = true;
      clearTimeout(timer);
      signal.removeEventListener(
        'abort',
        abort
      );
      unsubscribe();
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(cancelledError());
    const timer = setTimeout(
      () =>
        finish(
          new XmaxError({
            code: XmaxErrorCode.timeout,
            message: `${label} timed out`,
          }),
        ),
      milliseconds,
    );

    signal.addEventListener(
      'abort',
      abort
    );

    try {
      unsubscribe = subscribe(
        value => finish(
          null,
          value
        ),
        error => finish(error),
      );
      if (done) unsubscribe();
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * Schedules nonoverlapping heartbeats. The returned stop function cancels scheduling and the active
 * request without reporting later errors.
 *
 * @param action The work performed under this operation's cancellation and ownership lease.
 * @param onError The operation failure handler.
 * @param interval The interval between requests; defaults to 10000 ms.
 */
export function repeatHeartbeat(
  action: (
    signal: AbortSignal
  ) => Promise<void>,
  onError: (
    error: unknown
  ) => void,
  interval = 10000,
): () => void {
  let stopped = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      await action(controller.signal);
    } catch (error) {
      if (!stopped) onError(error);
    }
    if (!stopped) timer = setTimeout(
      tick,
      interval
    );
  };

  timer = setTimeout(
    tick,
    interval
  );

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}

/**
 * Stops waiting on cancellation without cancelling the underlying Promise.
 *
 * Use only when a late result requires no additional resource release.
 *
 * @param promise The underlying task; cancellation only stops awaiting its result.
 * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
 * @returns The underlying result, or immediate rejection when the signal is aborted.
 */
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelledError());

    if (signal.aborted) {
      void promise.catch(() => {});
      reject(cancelledError());
      return;
    }

    signal.addEventListener(
      'abort',
      abort,
      { once: true }
    );
    promise
      .then(
      resolve,
      reject
    )
      .finally(() => signal.removeEventListener(
        'abort',
        abort
      ));
  });
}
