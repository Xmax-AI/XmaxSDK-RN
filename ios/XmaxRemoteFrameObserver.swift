//
//  XmaxRemoteFrameObserver.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import CoreVideo
import Foundation
@preconcurrency import AgoraRtcKit

/// A one-shot observer of decoded result readiness without copying or exporting video frames.
final class XmaxRemoteFrameObserver: NSObject, AgoraVideoFrameDelegate, @unchecked Sendable {

  /// The lock protecting the active observation across RTC and command queues.
  private let lock = NSLock()

  /// The room, account, and generation observation token accepting the next frame.
  private var request: (roomID: String, uid: UInt, token: String)?

  /// The callback receiving one matching frame's account, room, and observation token.
  private let onReady: @Sendable (UInt, String, String) -> Void

  /// Creates a decoded-frame readiness observer.
  init(
    onReady: @escaping @Sendable (UInt, String, String) -> Void
  ) {
    self.onReady = onReady
  }

  /// Observes the next valid decoded frame for the requested room and account.
  ///
  /// - Parameters:
  ///   - roomID: The RTC room containing the result.
  ///   - uid: The native result account identifier.
  ///   - token: The generation observation token rejecting retired notifications.
  func observe(
    roomID: String,
    uid: UInt,
    token: String
  ) {
    lock.withLock {
      request = (roomID, uid, token)
    }
  }

  /// Clears an observation without cancelling a newer generation's request.
  ///
  /// - Parameter token: The observation to clear, or `nil` to clear any active request.
  func clear(
    token: String? = nil
  ) {
    lock.withLock {
      if token == nil || request?.token == token { request = nil }
    }
  }

  /// Requests decoded NV12 pixel buffers without allocating an SDK-owned copy.
  ///
  /// - Returns: The native NV12 pixel-buffer format.
  func getVideoFormatPreference() -> AgoraVideoFormat {
    .cvPixelNV12
  }

  /// Observes received frames before RTC rendering, including when no view is mounted.
  ///
  /// - Returns: The pre-render observation position.
  func getObservedFramePosition() -> AgoraVideoFramePosition {
    .preRenderer
  }

  /// Retains the original decoded frame without modifying pixels.
  ///
  /// - Returns: The read-only processing mode.
  func getVideoFrameProcessMode() -> AgoraVideoFrameProcessMode {
    .readOnly
  }

  /// Reports readiness once for a matching decoded frame and preserves RTC rendering.
  ///
  /// - Parameters:
  ///   - frame: The decoded frame owned by RTC for the duration of this callback.
  ///   - uid: The native account publishing the frame.
  ///   - channelId: The RTC room containing the frame.
  ///
  /// - Returns: Always `true`, preserving the unmodified frame.
  func onRenderVideoFrame(
    _ frame: AgoraOutputVideoFrame,
    uid: UInt,
    channelId: String
  ) -> Bool {
    guard let buffer = frame.pixelBuffer,
      CVPixelBufferGetWidth(buffer) > 0, CVPixelBufferGetHeight(buffer) > 0
    else { return true }

    let token = lock.withLock { () -> String? in
      guard let pending = request, pending.uid == uid, pending.roomID == channelId else {
        return nil
      }
      request = nil
      return pending.token
    }
    if let token {
      onReady(
        uid,
        channelId,
        token
      )
    }
    return true
  }
}
