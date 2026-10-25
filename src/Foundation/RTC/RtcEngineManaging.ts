//
//  RtcEngineManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcPlatform } from './RtcPlatform';
import type { RtcEngineLease } from './RtcEngineLease';

/**
 * An interface for cancellable, exclusive engine ownership.
 */
export interface RtcEngineManaging {

  /**
   * Waits for an exclusive native media lease.
   *
   * @param platform The native platform creating the engine.
   * @param signal The acquisition cancellation signal.
   * @returns The exclusive lease retained until release.
   */
  acquire(
    platform: RtcPlatform,
    signal: AbortSignal
  ): Promise<RtcEngineLease>;

  /**
   * Releases the matching lease after native engine destruction.
   *
   * @param lease The lease to return; stale releases are ignored.
   */
  release(
    lease: RtcEngineLease
  ): void;
}
