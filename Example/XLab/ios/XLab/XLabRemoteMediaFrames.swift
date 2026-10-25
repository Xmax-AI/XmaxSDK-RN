import Foundation
import React
import XmaxReactNativeSDK

/// Counts delivered packets without retaining video pixel buffers or PCM data.
private final class XLabRemoteMediaFrameCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var audioPackets = 0
  private var videoFrames = 0

  func receive(_ frame: RealtimeMediaFrame) {
    lock.withLock {
      switch frame.content {
      case .audio: audioPackets += 1
      case .video: videoFrames += 1
      }
    }
  }

  /// Returns cumulative counts for this receiver's lifetime.
  func snapshot() -> [String: Int] {
    lock.withLock { ["audioPackets": audioPackets, "videoFrames": videoFrames] }
  }
}

/// Retains the native receiver and consumes its packets on the SDK delivery queue.
private final class XLabRemoteMediaFrameReceiver {
  let counter: XLabRemoteMediaFrameCounter
  let consumer: RealtimeMediaFrameConsumer

  init() {
    let counter = XLabRemoteMediaFrameCounter()
    self.counter = counter
    consumer = RealtimeMediaFrameConsumer { frame in counter.receive(frame) }
  }
}

/// Exposes receiver handles and scalar statistics; media bytes stay native.
@objc(XLabRemoteMediaFrames)
final class XLabRemoteMediaFrames: NSObject, RCTInvalidating {
  private let lock = NSLock()
  private var receivers: [String: XLabRemoteMediaFrameReceiver] = [:]
  private var invalidated = false

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  @objc(createConsumer:reject:)
  func createConsumer(
    _ resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    let receiver = lock.withLock { () -> XLabRemoteMediaFrameReceiver? in
      guard !invalidated else { return nil }
      let receiver = XLabRemoteMediaFrameReceiver()
      receivers[receiver.consumer.nativeHandle] = receiver
      return receiver
    }
    guard let receiver else {
      reject("MEDIA_ERROR", "Remote media receivers are unavailable", nil)
      return
    }
    resolve(receiver.consumer.nativeHandle)
  }

  @objc(getStatistics:resolve:reject:)
  func getStatistics(
    _ handle: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard let receiver = lock.withLock({ receivers[handle] }) else {
      reject("MEDIA_ERROR", "Remote media receiver is unavailable", nil)
      return
    }
    resolve(receiver.counter.snapshot())
  }

  /// Releases only this handle after JavaScript has removed its SDK registration.
  @objc(releaseConsumer:resolve:reject:)
  func releaseConsumer(
    _ handle: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    lock.withLock { receivers.removeValue(forKey: handle) }?.consumer.invalidate()
    resolve(nil)
  }

  @objc
  func invalidate() {
    let previous = lock.withLock {
      invalidated = true
      let previous = Array(receivers.values)
      receivers.removeAll()
      return previous
    }
    for receiver in previous { receiver.consumer.invalidate() }
  }
}
