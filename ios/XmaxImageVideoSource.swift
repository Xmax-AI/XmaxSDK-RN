//
//  XmaxImageVideoSource.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import CoreMedia
import CoreVideo
import Foundation
import ImageIO
@preconcurrency import AgoraRtcKit

/// A source that decodes and repeatedly sends image frames on a serial native queue with a new
/// timestamp per frame. Submission stops when resources are released.
final class XmaxImageVideoSource: @unchecked Sendable {

  /// The resource lock shared by media startup, frame submission, and release.
  private let gate: NSRecursiveLock

  /// The serial queue for image decoding and scheduled frame submission.
  private let worker = DispatchQueue(label: "ai.xmax.image-video")

  /// The scheduled frame task, cleared before the native engine is destroyed.
  private var timer: DispatchSourceTimer?

  /// The source revision used to reject stale decoding results and scheduled tasks after stopping.
  private var generation: UInt = 0

  /// Creates an image frame source using a shared resource lock.
  ///
  /// - Parameter gate: The runtime resource lock that prevents frame submission from overlapping
  ///   engine destruction.
  init(
    gate: NSRecursiveLock
  ) {
    self.gate = gate
  }

  /// Decodes a prepared image and schedules repeated frame submission only while resource ownership
  /// remains valid.
  ///
  /// Completes after decoding and frame scheduling; failures reject the Promise with an SDK error
  /// code.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - path: The absolute path of the SDK-owned image copy.
  ///   - width: The width, in pixels.
  ///   - height: The height, in pixels.
  ///   - fps: The frame rate, in fps.
  ///   - active: The check that determines whether decoding or frame submission still belongs to
  ///     the current foreground media owner.
  ///   - promise: The React Native Promise resolved or rejected when the asynchronous native
  ///     operation completes.
  func start(
    engine: AgoraRtcEngineKit,
    path: String,
    width: Int,
    height: Int,
    fps: Int,
    active: @escaping @Sendable () -> Bool,
    promise: XmaxNativePromise
  ) {
    guard
      XmaxImageVideoFormat.isValid(
        width: Double(width),
        height: Double(height),
        fps: Double(fps)
      )
    else {
      promise.reject("Invalid image video format")
      return
    }

    let token = gate.xmaxWithLock {
      stop()

      return generation
    }

    worker.async {
      autoreleasepool {
        let pixels: CVPixelBuffer

        do {
          pixels = try Self.decode(
            path: path,
            width: width,
            height: height
          )
        } catch {
          promise.reject(
            error.localizedDescription,
            error: error
          )
          return
        }

        self.gate.xmaxWithLock {
          guard token == self.generation, active() else {
            promise.reject(
              "Image source was cancelled",
              code: "CANCELLED"
            )
            return
          }

          let push = { [weak self] in
            guard self != nil else { return }
            let frame = AgoraVideoFrame()
            frame.format = 12
            frame.textureBuf = pixels
            frame.strideInPixels = Int32(width)
            frame.height = Int32(height)
            frame.rotation = 0
            frame.time = CMClockGetTime(CMClockGetHostTimeClock())
            _ = engine.pushExternalVideoFrame(frame)
          }

          // Native frame submission and the local React Native Image preview share the same prepared image.
          push()

          let interval = DispatchTimeInterval.nanoseconds(1_000_000_000 / fps)
          let timer = DispatchSource.makeTimerSource(queue: self.worker)
          self.timer = timer

          timer.setEventHandler { [weak self] in
            autoreleasepool {
              guard let self else {
                return
              }

              self.gate.xmaxWithLock {
                guard token == self.generation, active() else {
                  return
                }

                push()

                // Schedules the next frame after the previous native submission completes to prevent overlapping submissions.
                self.timer?.schedule(
                  deadline: .now() + interval,
                  leeway: .milliseconds(1)
                )
              }
            }
          }

          timer.schedule(
            deadline: .now() + interval,
            leeway: .milliseconds(1)
          )
          timer.resume()

          promise.resolve()
        }
      }
    }
  }

  /// Stops scheduled frame submission and invalidates pending decoding results before engine
  /// release.
  func stop() {
    gate.xmaxWithLock {
      generation &+= 1
      timer?.cancel()
      timer = nil
    }
  }

  /// Decodes the complete upright image at the target dimensions into an immutable pixel buffer.
  ///
  /// - Parameters:
  ///   - path: The absolute path of the SDK-owned image copy.
  ///   - width: The width, in pixels.
  ///   - height: The height, in pixels.
  ///
  /// - Returns: The immutable native pixel buffer containing the complete upright image.
  ///
  /// - Throws: An operation error caused by invalid parameters or unavailable native resources.
  private static func decode(
    path: String,
    width: Int,
    height: Int
  ) throws -> CVPixelBuffer {
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()

    guard
      url.deletingLastPathComponent().path
        == XmaxImageManager.directory.resolvingSymlinksInPath().path,
      url.pathExtension == "jpg",
      let source = CGImageSourceCreateWithURL(
        url as CFURL,
        nil
      ),
      let image = CGImageSourceCreateImageAtIndex(
        source,
        0,
        nil
      ),
      image.width == width, image.height == height
    else {
      throw XmaxNativeFailure(
        message: "Unable to decode prepared image at the video format dimensions"
      )
    }

    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:],
    ]
    var output: CVPixelBuffer?

    guard
      CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_32BGRA,
        attributes as CFDictionary,
        &output
      ) == kCVReturnSuccess,
      let pixels = output,
      CVPixelBufferLockBaseAddress(
        pixels,
        []
      ) == kCVReturnSuccess
    else {
      throw XmaxNativeFailure(message: "Unable to allocate image video pixels")
    }
    defer {
      CVPixelBufferUnlockBaseAddress(
        pixels,
        []
      )
    }

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: CVPixelBufferGetBaseAddress(pixels),
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pixels),
        space: colorSpace,
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue
          | CGImageAlphaInfo.premultipliedFirst.rawValue
      )
    else {
      throw XmaxNativeFailure(message: "Unable to prepare image video pixels")
    }
    context.draw(
      image,
      in: CGRect(
        x: 0,
        y: 0,
        width: width,
        height: height
      )
    )

    return pixels
  }
}
