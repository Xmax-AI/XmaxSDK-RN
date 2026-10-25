//
//  ExternalVideoControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type { RealtimeExternalVideoSource } from './RealtimeExternalVideoSource';

/**
 * Controls an app-owned external source attachment and its preview stream.
 */
export interface ExternalVideoControlling {

  /**
   * The attached external input stream.
   */
  readonly stream: RealtimeMediaStream | null;

  /**
   * Whether the attached source publishes external audio.
   */
  readonly hasAudio: boolean;

  /**
   * Starts an external source without acquiring camera or microphone permissions.
   *
   * @param source The app-owned source, including its stable format and optional audio declaration.
   * @param signal The attachment's cancellation signal.
   * @returns The preview and generation stream after source startup.
   */
  create(
    source: RealtimeExternalVideoSource,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream>;

  /**
   * Invalidates the sink before stopping its producer and releasing preview and RTC resources.
   */
  close(): Promise<void>;
}
