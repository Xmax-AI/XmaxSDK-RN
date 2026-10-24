//
//  QualityController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { QualityControlling } from './QualityControlling';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import { monotonicTime } from '../../Foundation/Runtime/MonotonicTime';
import type {
  MediaSize,
  RealtimeNetworkQuality,
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';

import { QualityDirection } from './QualityDirection';
import { qualityFormat, scales } from './QualityVideoFormat';
import type { RealtimeQualityLevel } from '../../Service/Realtime/RealtimeTypes';

/**
 * The controller for independent uplink and downlink quality, with one-hour per-model history.
 */
export class QualityController implements QualityControlling {

  /**
   * The uplink adaptation state for the media baseline.
   */
  private up: QualityDirection | null = null;

  /**
   * The downlink adaptation state for the media baseline.
   */
  private down: QualityDirection | null = null;

  /**
   * The model identifier isolating quality history.
   */
  private model = '';

  /**
   * The revision used to reject late asynchronous results.
   */
  private version = 0;

  /**
   * Creates independent uplink and downlink quality policies using per-model history.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManaging,
  ) {}

  /**
   * The most recently applied uplink level.
   */
  get uplinkQualityLevel(): RealtimeQualityLevel | null {
    return this.up?.level ?? null;
  }

  /**
   * The most recently submitted downlink level; received dimensions may change later.
   */
  get downlinkQualityLevel(): RealtimeQualityLevel | null {
    return this.down?.level ?? null;
  }

  /**
   * The applied uplink encoding format.
   */
  get uplink(): RealtimeVideoFormat | null {
    return this.up?.format ?? null;
  }

  /**
   * The downlink dimension bounds, in pixels.
   *
   * @returns The downlink bounds before model alignment, in pixels.
   */
  get targetMaximum(): MediaSize | null {
    if (!this.down) return null;
    const baseline = this.down.baseline;
    const shortSide = Math.min(baseline.width, baseline.height);
    const scale = Math.max(
      scales[this.down.level - 1]!,
      Math.min(shortSide, 240) / shortSide,
    );
    return { width: baseline.width * scale, height: baseline.height * scale };
  }

  /**
   * Restores valid model history and resolves transport formats from the original media baseline.
   *
   * Invalid or expired history uses the default level. Superseded preparation cannot replace a
   * newer baseline.
   *
   * @param baseline The original media format used as the transport baseline.
   * @param model The model identifier used to isolate quality history.
   */
  async prepare(
    baseline: RealtimeVideoFormat,
    model: string
  ): Promise<void> {
    const version = ++this.version;
    this.model = model;
    const levels = await Promise.all(
      [false, true].map(async downlink => {
        try {
          const value = JSON.parse(
            await this.rtc.readPreference(this.key(
              model,
              downlink
            )),
          );
          const age = Date.now() - value.time;
          return Number.isInteger(value.level) &&
            value.level >= 1 &&
            value.level <= 5 &&
            age >= 0 &&
            age < 3600000
            ? (value.level as number)
            : 2;
        } catch {
          return 2;
        }
      }),
    );
    if (version !== this.version) return;
    this.up = new QualityDirection(
      baseline,
      levels[0]!,
      false
    );
    this.down = new QualityDirection(
      baseline,
      levels[1]!,
      true
    );
  }

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
    sampledAt = monotonicTime(),
  ): {

    /**
     * The proposed uplink level.
     */
    uplink: number | null;

    /**
     * The proposed downlink level.
     */
    downlink: number | null;
  } {
    const now = monotonicTime();
    return {
      uplink: this.up?.propose(
        quality.uplink,
        sampledAt,
        now
      ) ?? null,
      downlink: this.down?.propose(
        quality.downlink,
        sampledAt,
        now
      ) ?? null,
    };
  }

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
  ): RealtimeVideoFormat | null {
    const direction = downlink ? this.down : this.up;
    return direction
      ? qualityFormat(
        direction.baseline,
        level,
        downlink
      )
      : null;
  }

  /**
   * Resolves unaligned downlink dimension bounds for a level.
   *
   * @param level The transport level, from 1 for highest quality to 5 for lowest.
   * @returns The downlink bounds, in pixels, or null before a baseline is prepared.
   */
  maximum(
    level: number
  ): MediaSize | null {
    if (!this.down) return null;
    const source = this.down.baseline;
    const shortSide = Math.min(source.width, source.height);
    const scale = Math.max(
      scales[level - 1]!,
      Math.min(shortSide, 240) / shortSide,
    );
    return { width: source.width * scale, height: source.height * scale };
  }

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
  ): void {
    (downlink ? this.down : this.up)?.complete(
      level,
      success,
      monotonicTime()
    );
    if (success)
      void this.rtc
        .writePreference(
          this.key(
            this.model,
            downlink
          ),
          JSON.stringify({ level, time: Date.now() }),
        )
        .catch(() => {});
  }

  /**
   * Clears consecutive-sample counters and the last sample time.
   */
  resetSamples(): void {
    this.up?.resetSamples();
    this.down?.resetSamples();
  }

  /**
   * Clears the quality baseline and invalidates pending history reads.
   */
  reset(): void {
    this.version++;
    this.up = null;
    this.down = null;
  }

  /**
   * Creates a storage key isolated by model and transport direction.
   *
   * @param model The model identifier used to isolate quality history.
   * @param downlink Whether to use the downlink policy.
   */
  private key(
    model: string,
    downlink: boolean
  ): string {
    return `quality.${model}.${downlink ? 'down' : 'up'}`;
  }
}
