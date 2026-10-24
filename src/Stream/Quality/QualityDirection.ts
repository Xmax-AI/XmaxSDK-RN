//
//  QualityDirection.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { resolveBitrates } from '../Encoding/EncodingBitratePolicy';
import { qualityFormat } from './QualityVideoFormat';
import type {
  RealtimeNetworkQualityLevel,
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * The sampling and adaptation policy for one transport direction.
 */
export class QualityDirection {

  /**
   * The consecutive good-sample count for upgrades.
   */
  private good = 0;

  /**
   * The consecutive poor-sample count for downgrades.
   */
  private poor = 0;

  /**
   * The last accepted sample time, in monotonic seconds.
   */
  private lastSample: number | null = null;

  /**
   * The earliest next quality adjustment time, in monotonic seconds.
   */
  private stableUntil = 0;

  /**
   * The earliest upgrade retry after probe rollback, in monotonic seconds.
   */
  private upgradeAfter = 0;

  /**
   * The upgrade probe deadline, in monotonic seconds.
   */
  private probeUntil = 0;

  /**
   * The transport level, from 1 for highest quality to 5 for lowest.
   */
  level: number;

  /**
   * Creates a direction policy with the original media format and initial level.
   *
   * @param baseline The original media format used as the transport baseline.
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @param downlink Whether to use the downlink policy.
   */
  constructor(
    /**
     * The original media format used as the transport baseline.
     */
    readonly baseline: RealtimeVideoFormat,
    level: number,

    /**
     * Whether to use the downlink policy.
     */
    readonly downlink: boolean,
  ) {
    this.level = Math.min(5, Math.max(1, level));
    while (this.level > 1 && !this.supports(this.level)) this.level--;
  }

  /**
   * The transport format resolved from the baseline and current level.
   */
  get format(): RealtimeVideoFormat {
    return qualityFormat(
      this.baseline,
      this.level,
      this.downlink
    );
  }

  /**
   * Clears consecutive-sample counters and the last sample time.
   */
  resetSamples(): void {
    this.good = 0;
    this.poor = 0;
    this.lastSample = null;
  }

  /**
   * Proposes a level when consecutive samples satisfy stability and cooldown rules.
   *
   * @param quality The network quality sample for this transport direction.
   * @param sampledAt The sample time, in monotonic seconds.
   * @param now The current monotonic time, in seconds, used for stability, cooldown, and sample-age
   *   checks.
   * @returns The candidate level, or null for no change.
   */
  propose(
    quality: RealtimeNetworkQualityLevel,
    sampledAt: number,
    now: number,
  ): number | null {
    if (
      sampledAt > now ||
      (this.lastSample !== null && sampledAt <= this.lastSample)
    )
      return null;
    if (this.lastSample !== null && sampledAt - this.lastSample > 5)
      this.resetSamples();
    this.lastSample = sampledAt;
    if (now - sampledAt > 5 || now < this.stableUntil) {
      this.good = 0;
      this.poor = 0;
      return null;
    }
    let step: number;
    if (quality === 'Bad' || quality === 'VeryBad') {
      this.good = 0;
      if (++this.poor < 3) return null;
      step = 1;
    } else if (quality === 'Excellent' || quality === 'Good') {
      this.poor = 0;
      if (++this.good < 5 || now < this.upgradeAfter) return null;
      step = -1;
    } else {
      this.good = 0;
      this.poor = 0;
      return null;
    }
    for (
      let candidate = this.level + step;
      candidate >= 1 && candidate <= 5;
      candidate += step
    ) {
      const format = qualityFormat(
        this.baseline,
        candidate,
        this.downlink
      );
      if (
        this.supports(candidate) &&
        (format.width !== this.format.width ||
          format.height !== this.format.height ||
          format.fps !== this.format.fps)
      )
        return candidate;
    }
    return null;
  }

  /**
   * Records application success and updates stability, probe, and cooldown windows.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @param success Whether the level was applied successfully.
   * @param now The current monotonic time, in seconds, used for stability, cooldown, and sample-age
   *   checks.
   */
  complete(
    level: number,
    success: boolean,
    now: number
  ): void {
    this.resetSamples();
    this.stableUntil = now + 4;
    if (!success) return;
    if (level < this.level) this.probeUntil = now + 20;
    else if (level > this.level) {
      if (now < this.probeUntil) this.upgradeAfter = now + 60;
      this.probeUntil = 0;
    }
    this.level = level;
  }

  /**
   * Checks whether a level satisfies encoding constraints for this direction.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   */
  private supports(
    level: number
  ): boolean {
    try {
      if (!this.downlink) resolveBitrates(qualityFormat(
        this.baseline,
        level
      ));
      return true;
    } catch {
      return false;
    }
  }
}
