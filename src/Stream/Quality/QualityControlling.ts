//
//  QualityControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  MediaSize,
  RealtimeNetworkQuality,
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';

import type { RealtimeQualityLevel } from '../../Service/Realtime/RealtimeTypes';

/**
 * An interface for uplink and downlink quality policies and history.
 */
export interface QualityControlling {

  /**
   * The most recently applied uplink level.
   */
  readonly uplinkQualityLevel: RealtimeQualityLevel | null;

  /**
   * The most recently submitted downlink level; received dimensions may change later.
   */
  readonly downlinkQualityLevel: RealtimeQualityLevel | null;

  /**
   * The applied uplink encoding format.
   */
  readonly uplink: RealtimeVideoFormat | null;

  /**
   * The downlink dimension bounds, in pixels.
   *
   * @returns The downlink bounds before model alignment, in pixels.
   */
  readonly targetMaximum: MediaSize | null;

  /**
   * Restores valid model history and resolves transport formats from the original media baseline.
   *
   * Invalid or expired history uses the default level. Superseded preparation cannot replace a
   * newer baseline.
   *
   * @param baseline The original media format used as the transport baseline.
   * @param model The model identifier used to isolate quality history.
   */
  prepare(
    baseline: RealtimeVideoFormat,
    model: string
  ): Promise<void>;

  /**
   * Proposes direction-specific levels satisfying adaptation rules.
   *
   * @param quality The network quality sample for both directions or the selected direction.
   * @param sampledAt The monotonic sample time, in seconds; defaults to the current monotonic
   *   clock.
   * @returns The candidate level per direction, or null when no change is proposed.
   */
  propose(
    quality: RealtimeNetworkQuality,
    sampledAt?: number,
  ): {

    /**
     * The proposed uplink level.
     */
    uplink: number | null;

    /**
     * The proposed downlink level.
     */
    downlink: number | null;
  };

  /**
   * Resolves a transport level from the original baseline without modifying capture dimensions.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @param downlink Whether to use the downlink policy.
   * @returns The requested transport format, or null before a baseline is prepared.
   */
  format(
    level: number,
    downlink: boolean
  ): RealtimeVideoFormat | null;

  /**
   * Resolves unaligned downlink dimension bounds for a level.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @returns The downlink bounds, in pixels, or null before a baseline is prepared.
   */
  maximum(
    level: number
  ): MediaSize | null;

  /**
   * Records a quality change and persists only successfully applied levels.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @param downlink Whether to use the downlink policy.
   * @param success Whether the level was applied successfully.
   */
  complete(
    level: number,
    downlink: boolean,
    success: boolean
  ): void;

  /**
   * Clears consecutive-sample counters and the last sample time.
   */
  resetSamples(): void;

  /**
   * Clears the quality baseline and invalidates pending history reads.
   */
  reset(): void;
}
