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
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeVideoFormat';
import type { RealtimeNetworkQuality } from '../../Service/Realtime/RealtimeNetworkQuality';

import { QualityHistory } from './QualityHistory';
import { QualityDirection } from './QualityDirection';
import { qualityFormat, scales } from './QualityVideoFormat';
import type { RealtimeQualityLevel } from './RealtimeQualityLevel';

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
   * The current model's quality history; null disables history persistence.
   */
  private history: QualityHistory | null = null;

  /**
   * Whether automatic adaptation and history persistence are enabled.
   */
  private adaptiveEnabled = true;

  /**
   * The model minimum uplink pixel area.
   */
  private minimumInputPixels = 0;

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
   * @param minimumInputPixels The minimum uplink pixel area.
   * @param isAdaptiveQualityEnabled Whether to restore history and adapt quality; defaults to true.
   */
  async prepare(
    baseline: RealtimeVideoFormat,
    model: string,
    minimumInputPixels = 0,
    isAdaptiveQualityEnabled = true,
  ): Promise<void> {
    const version = ++this.version;
    const history = isAdaptiveQualityEnabled
      ? new QualityHistory(
        this.rtc,
        model
      )
      : null;
    this.history = history;
    this.adaptiveEnabled = isAdaptiveQualityEnabled;
    this.minimumInputPixels = minimumInputPixels;
    const levels = await Promise.all(
      [false, true].map(downlink => history?.read(downlink) ?? 1),
    );
    if (version !== this.version) return;
    this.up = new QualityDirection(
      baseline,
      levels[0]!,
      false,
      minimumInputPixels,
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
    if (!this.adaptiveEnabled) return { uplink: null, downlink: null };
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
          downlink,
          this.minimumInputPixels,
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
    if (success) void this.history?.write(
      level,
      downlink
    ).catch(() => {});
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
    this.history = null;
  }
}
