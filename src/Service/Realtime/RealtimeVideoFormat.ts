//
//  RealtimeVideoFormat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The width and height of an image or video, in pixels.
 */
export interface MediaSize {

  /**
   * The width, in pixels.
   */
  readonly width: number;

  /**
   * The height, in pixels.
   */
  readonly height: number;
}

/**
 * The encoding preference for balancing frame rate and resolution.
 */
export enum RealtimeVideoEncoderPreference {

  /**
   * Balances frame rate and resolution.
   */
  auto = 'auto',

  /**
   * Prioritizes frame rate; this is the default preference.
   */
  maintainFramerate = 'maintainFramerate',

  /**
   * Prioritizes image quality.
   */
  maintainQuality = 'maintainQuality',
}

/**
 * The video dimensions, frame rate, and uplink encoding settings.
 */
export interface RealtimeVideoFormat extends MediaSize {

  /**
   * The video frame rate, in fps; must be a positive integer.
   */
  readonly fps: number;

  /**
   * The minimum encoding bitrate, in kbps; defaults to 500, capped at the maximum bitrate. A value
   * of 0 removes the lower limit.
   */
  readonly minimumBitrate?: number | null;

  /**
   * The maximum encoding bitrate, in kbps; must be a positive integer. Defaults to the value
   * calculated by the SDK bitrate policy.
   */
  readonly maximumBitrate?: number | null;

  /**
   * The encoding preference; defaults to maintainFramerate and is preserved when input dimensions
   * are calculated.
   */
  readonly encoderPreference?: RealtimeVideoEncoderPreference;
}
