//
//  RtcStatsLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLoggerOption } from '../Logging/XmaxLoggerOption';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from './VideoStatistics';
import type { RealtimePerformanceAlarm } from '../../Service/Realtime/RealtimePerformanceAlarm';
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
  value === null
    ? XmaxLogger.localized(
      '不可用',
      'unavailable'
    )
    : `${value}${unit}`;

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
        `${XmaxLogger.localized('本地视频上行：', 'Local video uplink: ')}${number(stats.width)} × ${number(stats.height)}, ` +
        `${XmaxLogger.localized('采集 ', 'capture ')}${number(stats.captureFrameRate, ' fps')}, ${XmaxLogger.localized('编码 ', 'encode ')}${number(stats.encodeFrameRate, ' fps')}, ` +
        `${XmaxLogger.localized('发送 ', 'send ')}${number(stats.sendFrameRate, ' fps')}, ${number(stats.bitrateKbps, ' kbps')}, ${XmaxLogger.localized('丢包 ', 'loss ')}${number(stats.packetLossPercent, '%')}`,
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
        `${XmaxLogger.localized('远端视频下行：', 'Remote video downlink: ')}${number(stats.width)} × ${number(stats.height)}, ` +
        `${XmaxLogger.localized('解码 ', 'decode ')}${number(stats.decodeFrameRate, ' fps')}, ${XmaxLogger.localized('渲染 ', 'render ')}${number(stats.renderFrameRate, ' fps')}, ` +
        `${number(stats.bitrateKbps, ' kbps')}, ${XmaxLogger.localized('丢包 ', 'loss ')}${number(stats.packetLossPercent, '%')}, ${XmaxLogger.localized('延迟 ', 'delay ')}${number(stats.endToEndDelayMs, ' ms')}`,
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
      () =>
        `${XmaxLogger.localized('设备性能：', 'Device performance: ')}${
          alarm.status
        }`,
      XmaxLoggerOption.performance,
    );
  }
}
