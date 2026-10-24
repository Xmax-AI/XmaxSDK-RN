//
//  VideoStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The uplink video statistics; unavailable values are null.
 */
export interface UplinkVideoStatistics {

  /**
   * The actual encoded width, in pixels.
   */
  readonly width: number | null;

  /**
   * The actual encoded height, in pixels.
   */
  readonly height: number | null;

  /**
   * The actual capture frame rate, in fps.
   */
  readonly captureFrameRate: number | null;

  /**
   * The actual encoder output frame rate, in fps.
   */
  readonly encodeFrameRate: number | null;

  /**
   * The actual sending frame rate, in fps, excluding retransmissions.
   */
  readonly sendFrameRate: number | null;

  /**
   * The actual sending bitrate, in kbps, excluding retransmissions.
   */
  readonly bitrateKbps: number | null;

  /**
   * The video packet loss rate from the device to the RTC server before loss recovery, as a
   * percentage from 0 to 100.
   */
  readonly packetLossPercent: number | null;
}

/**
 * The statistics for the subscribed generation result; unavailable numeric values are null.
 */
export interface DownlinkVideoStatistics {

  /**
   * The string user account publishing the subscribed generation result.
   */
  readonly userID: string;

  /**
   * The received video width, in pixels.
   */
  readonly width: number | null;

  /**
   * The received video height, in pixels.
   */
  readonly height: number | null;

  /**
   * The actual decoder output frame rate, in fps.
   */
  readonly decodeFrameRate: number | null;

  /**
   * The actual rendering frame rate, in fps.
   */
  readonly renderFrameRate: number | null;

  /**
   * The actual receiving bitrate over the latest reporting interval, in kbps.
   */
  readonly bitrateKbps: number | null;

  /**
   * The subscribed video packet loss rate after loss recovery, as a percentage from 0 to 100.
   */
  readonly packetLossPercent: number | null;

  /**
   * The end-to-end video latency, in milliseconds.
   */
  readonly endToEndDelayMs: number | null;
}
