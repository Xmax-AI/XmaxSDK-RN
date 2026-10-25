//
//  RealtimeVideoFrame.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import CoreMedia
import CoreVideo

/// An owned, upright decoded frame from the remote video pipeline.
public struct RealtimeVideoFrame: @unchecked Sendable {

  /// The frame's pixel buffer.
  ///
  /// The BGRA pixels remain valid after the callback returns. Treat them as read-only and retain
  /// the buffer until asynchronous processing completes.
  public let pixelBuffer: CVPixelBuffer

  /// The frame's presentation time on the realtime timeline.
  ///
  /// Timestamps may not start at zero. Use the first received frame as the recording origin.
  public let presentationTimeStamp: CMTime

  /// The suggested display duration, or `.invalid` if unknown.
  public let duration: CMTime

  /// Creates a realtime frame for display or recording.
  init(
    pixelBuffer: CVPixelBuffer,
    presentationTimeStamp: CMTime,
    duration: CMTime = .invalid
  ) {
    self.pixelBuffer = pixelBuffer
    self.presentationTimeStamp = presentationTimeStamp
    self.duration = duration
  }
}
