//
//  QualityHistory.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';

/**
 * The successfully applied model and directional levels retained for one hour.
 */
export class QualityHistory {

  /**
   * Creates model-specific quality history using the native preference store.
   */
  constructor(
    /**
     * The native preference interface; quality history does not contain credentials.
     */
    private readonly preferences: Pick<
      RtcManaging,
      'readPreference' | 'writePreference'
    >,

    /**
     * The model identifier isolating quality levels.
     */
    private readonly model: string,
  ) {}

  /**
   * Reads a valid directional level from the last hour.
   *
   * @param downlink Whether to read downlink rather than uplink.
   * @returns The saved level, or L2 when history is missing, invalid, or expired.
   */
  async read(
    downlink: boolean
  ): Promise<number> {
    try {
      const value = JSON.parse(
        await this.preferences.readPreference(this.key(downlink)),
      );
      const age = Date.now() - value.time;
      return Number.isFinite(value.time) &&
        value.time > 0 &&
        Number.isInteger(value.level) &&
        value.level >= 1 &&
        value.level <= 5 &&
        age >= 0 &&
        age < 3600000
        ? value.level
        : 2;
    } catch {
      return 2;
    }
  }

  /**
   * Persists a successfully applied model and directional level.
   *
   * @param level The applied quality level, from 1 to 5.
   * @param downlink Whether to store downlink rather than uplink.
   */
  async write(
    level: number,
    downlink: boolean
  ): Promise<void> {
    await this.preferences.writePreference(
      this.key(downlink),
      JSON.stringify({ level, time: Date.now() }),
    );
  }

  /**
   * Creates a model-specific directional preference key.
   *
   * @param downlink Whether this is the downlink direction.
   * @returns The model and direction preference key.
   */
  private key(
    downlink: boolean
  ): string {
    return `quality.${this.model}.${downlink ? 'down' : 'up'}`;
  }
}
