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
import CoreImage
import CoreMedia
import Foundation
@preconcurrency import AgoraRtcKit

/// Observes decoded readiness and delivers requested remote media through a bounded native queue.
final class XmaxRemoteFrameObserver: NSObject, AgoraVideoFrameDelegate, @unchecked Sendable {

  /// The lock protecting the active observation across RTC and command queues.
  private let lock = NSLock()

  /// The room, account, and generation observation token accepting the next frame.
  private var request: (roomID: String, uid: UInt, token: String)?

  /// The result user and stream identity accepting continuous native output.
  private var output: (roomID: String, uid: UInt, streamID: UUID)?

  /// The bounded background dispatcher shared by remote video and PCM.
  private let dispatcher = RealtimeMediaFrameDispatcher()

  /// The reusable image processor producing owned upright video buffers.
  private let imageContext = CIContext()

  /// Configures output without changing the independent first-frame observation.
  ///
  /// - Parameters:
  ///   - consumer: The app-owned receiver, or nil to discard queued output.
  ///   - roomID: The result room identity.
  ///   - uid: The result account's native identifier.
  ///   - streamID: The shared binding identity, retained when only the listener changes.
  func setOutput(
    consumer: RealtimeMediaFrameConsumer?,
    roomID: String = "",
    uid: UInt = 0,
    streamID: UUID? = nil
  ) {
    lock.withLock {
      if output?.streamID != streamID { dispatcher.setStream(streamID) }
      if let consumer, let streamID {
        output = (roomID, uid, streamID)
        dispatcher.setListener { [weak consumer] in consumer?.receive($0) }
      } else {
        output = nil
        dispatcher.setListener(nil)
        dispatcher.setStream(nil)
      }
    }
  }

  /// Resolves a current result user's PCM handler before native bytes are copied.
  ///
  /// - Parameters:
  ///   - uid: The account supplying the packet.
  ///   - roomID: The packet's RTC room.
  /// - Returns: The binding-guarded receiver, or nil when output is not requested.
  func audioListener(
    uid: UInt,
    roomID: String
  ) -> RtcRemoteAudioFrameListener? {
    lock.withLock {
      guard let output, output.uid == uid, output.roomID == roomID else { return nil }
      return { [dispatcher] in
        dispatcher.dispatchAudio(
          $0,
          streamID: output.streamID
        )
      }
    }
  }

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

  /// Requests native NV12 input for readiness detection and optional owned output conversion.
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
    let identity = lock.withLock { () -> UUID? in
      guard let output, output.uid == uid, output.roomID == channelId else { return nil }
      return output.streamID
    }
    if let identity {
      guard frame.renderTimeMs > 0 else {
        dispatcher.discardVideo(streamID: identity)
        return true
      }
      var image = CIImage(cvPixelBuffer: buffer)
      let orientation: Int32 =
        switch frame.rotation {
        case 90: 6
        case 180: 3
        case 270: 8
        default: 1
        }
      image = image.oriented(forExifOrientation: orientation)
      let bounds = image.extent
      var copy: CVPixelBuffer?
      if CVPixelBufferCreate(
        kCFAllocatorDefault,
        Int(bounds.width),
        Int(bounds.height),
        kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary,
        &copy
      ) == kCVReturnSuccess, let copy {
        imageContext.render(
          image.transformed(
            by: CGAffineTransform(
              translationX: -bounds.minX,
              y: -bounds.minY
            )
          ),
          to: copy
        )
        dispatcher.dispatchVideo(
          RealtimeVideoFrame(
            pixelBuffer: copy,
            presentationTimeStamp: CMTime(
              value: frame.renderTimeMs,
              timescale: 1000
            )
          ),
          streamID: identity
        )
      } else {
        dispatcher.discardVideo(streamID: identity)
      }
    }
    return true
  }
}
