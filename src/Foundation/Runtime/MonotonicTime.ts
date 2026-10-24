//
//  MonotonicTime.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Reads monotonic time for sampling, throttling, and elapsed durations, not calendar dates.
 *
 * @returns The monotonic time, in seconds, used only for elapsed intervals.
 */
export function monotonicTime(): number {
  const runtime = globalThis as unknown as {

    /**
     * The runtime monotonic clock interface.
     */
    performance: {

      /**
       * Reads monotonic time for elapsed-duration calculations.
       *
       * @returns The monotonic time, in milliseconds.
       */
      now(): number;
    };
  };

  return runtime.performance.now() / 1000;
}
