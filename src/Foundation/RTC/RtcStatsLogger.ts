//
//  RtcStatsLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLoggerOption } from '../../Core/XmaxConfiguration';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
  RealtimePerformanceAlarm,
} from '../../Service/Realtime/RealtimeTypes';
import { XmaxLogger } from '../Logging/XmaxLogger';

/**
 * Formats measured video metrics with units and a placeholder for missing values.
 *
 * @param value The metric reported by native transport.
 * @param unit The measured value's unit suffix.
 */
const number = (
  value: number | null,
  unit = ''
) =>
  value === null ? 'unavailable' : `${value}${unit}`;

/**
 * Formats RTC statistics for Xmax logs.
 */
export class RtcStatsLogger {

  /**
   * Logs uplink video statistics when performance logging is enabled.
   *
   * @param stats The video statistics snapshot, with missing values following the type contract.
   */
  static local(
    stats: UplinkVideoStatistics
  ): void {
    XmaxLogger.rtc.debug(
      () =>
        `Local video uplink: ${number(stats.width)} × ${number(stats.height)}, ` +
        `capture ${number(stats.captureFrameRate, ' fps')}, encode ${number(stats.encodeFrameRate, ' fps')}, ` +
        `send ${number(stats.sendFrameRate, ' fps')}, ${number(stats.bitrateKbps, ' kbps')}, loss ${number(stats.packetLossPercent, '%')}`,
      XmaxLoggerOption.performance,
    );
  }

  /**
   * Logs result video statistics when performance logging is enabled.
   *
   * @param stats The video statistics snapshot, with missing values following the type contract.
   */
  static remote(
    stats: DownlinkVideoStatistics
  ): void {
    XmaxLogger.rtc.debug(
      () =>
        `Remote video downlink: ${number(stats.width)} × ${number(stats.height)}, ` +
        `decode ${number(stats.decodeFrameRate, ' fps')}, render ${number(stats.renderFrameRate, ' fps')}, ` +
        `${number(stats.bitrateKbps, ' kbps')}, loss ${number(stats.packetLossPercent, '%')}, delay ${number(stats.endToEndDelayMs, ' ms')}`,
      XmaxLoggerOption.performance,
    );
  }

  /**
   * Logs encoder performance limitation and recovery events when enabled.
   *
   * @param alarm The performance status and suggested encoding format.
   */
  static alarm(
    alarm: RealtimePerformanceAlarm
  ): void {
    XmaxLogger.rtc.debug(
      () => `Device performance: ${alarm.status}`,
      XmaxLoggerOption.performance,
    );
  }
}
