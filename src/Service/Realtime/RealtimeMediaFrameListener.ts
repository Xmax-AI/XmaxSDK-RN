//
//  RealtimeMediaFrameListener.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * An app-owned Swift or Kotlin receiver for remote audio and video frames.
 * Create and retain a native RealtimeMediaFrameConsumer, then pass its handle to this registration.
 * Media stays native; JavaScript receives neither per-frame events nor pixel or PCM bytes.
 */
export interface RealtimeMediaFrameListener {

  /**
   * The nonreusable handle of a live native RealtimeMediaFrameConsumer.
   * Remove this listener before releasing or invalidating the native consumer.
   */
  readonly nativeHandle: string;
}
