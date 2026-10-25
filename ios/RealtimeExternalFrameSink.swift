//
//  RealtimeExternalFrameSink.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import AVFoundation
import CoreImage
import CoreVideo
@preconcurrency import AgoraRtcKit

/// The processed video dimensions and frame rate for an external source attachment.
public struct RealtimeExternalVideoFormat: Sendable {
  /// The processed width, in pixels.
  public let width: Int

  /// The processed height, in pixels.
  public let height: Int

  /// The requested frame rate, in frames per second.
  public let fps: Int
}

/// A native receiver for one app-owned external video source and optional PCM audio.
/// Resolve the handle supplied to the TypeScript source's start callback. Submit frames from any
/// serial capture queue; buffers can be reused after submission returns. Your app owns permissions,
/// capture resources, and pacing. Submitted audio is never played locally.
public final class RealtimeExternalFrameSink: @unchecked Sendable {
  /// The lock protecting the registry of live native attachments.
  private static let registryLock = NSLock()

  /// The receivers indexed by expiring attachment identities.
  nonisolated(unsafe) private static var registry: [String: RealtimeExternalFrameSink] = [:]

  /// Finds a live native receiver without taking ownership of its attachment.
  ///
  /// - Parameter nativeHandle: The handle passed to the app's JavaScript source callback.
  /// - Returns: The receiver, or nil after stopping, failure, or background release.
  public static func find(
    _ nativeHandle: String
  ) -> RealtimeExternalFrameSink? {
    registryLock.lock()
    let sink = registry[nativeHandle]
    registryLock.unlock()
    return sink?.isRequestingFrames == true ? sink : nil
  }

  /// The model-constrained dimensions used for preview and quality policy.
  public let videoFormat: RealtimeExternalVideoFormat

  /// The native attachment identity, invalidated permanently on release.
  private let handle: String

  /// The dimensions declared by the source before attachment.
  private let sourceSize: CGSize

  /// The lock serializing frame copying, timestamps, failure, and invalidation.
  private let lock = NSRecursiveLock()

  /// The RTC engine retained only until sink invalidation and engine release.
  private let engine: AgoraRtcEngineKit

  /// The shared image context performing orientation-preserving scaling.
  private let context = CIContext()

  /// The reusable pool for owned, processed BGRA output buffers.
  private let pixelPool: CVPixelBufferPool

  /// Whether the receiver accepts further source frames.
  private var active = true

  /// Whether custom resources have already been released.
  private var invalidated = false

  /// Whether external audio is currently published in a room.
  private var published = false

  /// The last accepted video timestamp, in microseconds.
  private var lastTimestampUs: Int64 = -1

  /// The serialized PCM conversion and packetization state.
  private var audio: XmaxExternalAudioFrameConverter?

  /// The external audio track identifier, or nil for video-only sources.
  let audioTrackID: Int?

  /// The first unrecoverable source failure callback.
  private let failure: @Sendable () -> Void

  /// Creates and registers an attachment after validating its source format.
  ///
  /// - Parameters:
  ///   - request: The scalar source and processed format configuration.
  ///   - engine: The exclusively leased RTC engine.
  ///   - failure: The first unrecoverable native source failure callback.
  /// - Throws: An error for invalid dimensions or unavailable custom audio resources.
  init(request: [String: Any], engine: AgoraRtcEngineKit, failure: @escaping @Sendable () -> Void)
    throws
  {
    guard let handle = request["sinkID"] as? String, !handle.isEmpty,
      let sourceWidth = request["sourceWidth"] as? Int,
      let sourceHeight = request["sourceHeight"] as? Int,
      let width = request["width"] as? Int, let height = request["height"] as? Int,
      let fps = request["fps"] as? Int,
      sourceWidth >= 2, sourceHeight >= 2, sourceWidth <= Int(Int32.max),
      sourceHeight <= Int(Int32.max),
      width > 0, height > 0, fps > 0, fps <= Int(Int32.max)
    else { throw XmaxNativeFailure(message: "Invalid external video format") }
    self.handle = handle
    self.sourceSize = CGSize(width: sourceWidth, height: sourceHeight)
    self.videoFormat = RealtimeExternalVideoFormat(width: width, height: height, fps: fps)
    self.engine = engine
    self.failure = failure
    var pool: CVPixelBufferPool?
    guard
      CVPixelBufferPoolCreate(
        kCFAllocatorDefault,
        nil,
        [
          kCVPixelBufferWidthKey: width,
          kCVPixelBufferHeightKey: height,
          kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
          kCVPixelBufferIOSurfacePropertiesKey: [:],
        ] as CFDictionary,
        &pool
      ) == kCVReturnSuccess, let pool
    else {
      throw XmaxNativeFailure(message: "Unable to prepare external video buffers")
    }
    pixelPool = pool
    if request["hasAudio"] as? Bool == true {
      let config = AgoraAudioTrackConfig()
      config.enableLocalPlayback = false
      config.enableAudioProcessing = false
      let id = engine.createCustomAudioTrack(.direct, config: config)
      guard id >= 0 else {
        throw XmaxNativeFailure(message: "Unable to create external audio track")
      }
      audioTrackID = Int(id)
      audio = XmaxExternalAudioFrameConverter()
    } else {
      audioTrackID = nil
    }
    Self.registryLock.lock()
    Self.registry[handle] = self
    Self.registryLock.unlock()
  }

  /// Whether this attachment accepts video and optional audio, including video while disconnected.
  public var isRequestingFrames: Bool { lock.xmaxWithLock { active } }

  /// Copies and scales upright source pixels before submitting them to preview and RTC.
  /// Invalid, duplicate, or decreasing timestamps are ignored. A malformed buffer fails the source.
  ///
  /// - Parameters:
  ///   - pixelBuffer: A source-sized upright BGRA or NV12 video-range buffer, with mirroring applied.
  ///   - timestamp: A nonnegative, strictly increasing timestamp on the shared monotonic timeline.
  public func pushVideo(
    _ pixelBuffer: CVPixelBuffer,
    timestamp: CMTime
  ) {
    guard timestamp.isNumeric, timestamp.epoch == 0, timestamp >= .zero else { return }
    let time = CMTimeConvertScale(timestamp, timescale: 1_000_000, method: .roundTowardZero)
    guard time.isNumeric, time.value >= 0 else { return }
    lock.xmaxWithLock {
      guard active, time.value > lastTimestampUs else { return }
      let format = CVPixelBufferGetPixelFormatType(pixelBuffer)
      guard CVPixelBufferGetWidth(pixelBuffer) == Int(sourceSize.width),
        CVPixelBufferGetHeight(pixelBuffer) == Int(sourceSize.height),
        format == kCVPixelFormatType_32BGRA
          || format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
      else { fail(); return }
      var output: CVPixelBuffer?
      guard
        CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pixelPool, &output)
          == kCVReturnSuccess,
        let output
      else { fail(); return }
      let image = CIImage(cvPixelBuffer: pixelBuffer).transformed(
        by: CGAffineTransform(
          scaleX: CGFloat(videoFormat.width) / sourceSize.width,
          y: CGFloat(videoFormat.height) / sourceSize.height
        )
      )
      context.render(image, to: output)
      let frame = AgoraVideoFrame()
      frame.format = 12
      frame.textureBuf = output
      frame.strideInPixels = Int32(videoFormat.width)
      frame.height = Int32(videoFormat.height)
      frame.rotation = 0
      frame.time = time
      lastTimestampUs = time.value
      _ = engine.pushExternalVideoFrame(frame)
    }
  }

  /// Copies and converts source PCM to 48 kHz mono PCM16 in 10 ms packets without local playback.
  /// The PCM format must remain stable. Invalid or overlapping timestamps are ignored; gaps start
  /// a new segment. Audio while unpublished is discarded rather than queued for reconnection.
  ///
  /// - Parameter sampleBuffer: Ready linear PCM with timestamps on the same timeline as video.
  public func pushAudio(
    _ sampleBuffer: CMSampleBuffer
  ) {
    lock.xmaxWithLock {
      guard active, let audio else { return }
      do {
        try audio.append(sampleBuffer) { frame in
          guard published, let audioTrackID else { return }
          frame.data.withUnsafeBytes { bytes in
            _ = engine.pushExternalAudioFrameRawData(
              UnsafeMutableRawPointer(mutating: bytes.baseAddress!),
              samples: 480,
              sampleRate: 48000,
              channels: 1,
              trackId: audioTrackID,
              timestamp: Double(frame.timestampUs) / 1000
            )
          }
        }
        if !published { audio.discardPendingAudio() }
      } catch { fail() }
    }
  }

  /// Reports the first unrecoverable capture or decoding error and rejects further frames.
  ///
  /// - Parameter error: The source failure; its contents are not written to SDK logs.
  public func reportError(
    _ error: any Error
  ) {
    lock.xmaxWithLock {
      if active { fail() }
    }
  }

  /// Updates audio publication and discards partial audio from the previous connection.
  ///
  /// - Parameter value: Whether the room accepts external audio.
  func setPublished(
    _ value: Bool
  ) {
    lock.xmaxWithLock {
      published = value
      audio?.discardPendingAudio()
    }
  }

  /// Rejects further frames and waits for copying to finish before releasing the custom audio track.
  func invalidate() {
    lock.xmaxWithLock {
      guard !invalidated else { return }
      invalidated = true
      active = false
      audio = nil
      if let audioTrackID { _ = engine.destroyCustomAudioTrack(audioTrackID) }
      Self.registryLock.lock()
      Self.registry.removeValue(forKey: handle)
      Self.registryLock.unlock()
    }
  }

  /// Invalidates a failed receiver before notifying lifecycle coordination.
  private func fail() {
    guard active else { return }
    active = false
    failure()
  }
}
