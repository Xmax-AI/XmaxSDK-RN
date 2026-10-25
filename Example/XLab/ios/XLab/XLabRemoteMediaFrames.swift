import Foundation
import Photos
import React
import XmaxReactNativeSDK

/// Shares encoder failures without retaining the recorder's owner.
private final class RecordingFailureState: @unchecked Sendable {
  private let lock = NSLock()
  private var failure: String?

  func read() -> String? { lock.withLock { failure } }

  func write(_ failure: String?) { lock.withLock { self.failure = failure } }
}

/// Retains a native recording consumer without transferring media through JavaScript.
private final class XLabRemoteMediaFrameReceiver: @unchecked Sendable {
  private let lock = NSLock()
  private let failure = RecordingFailureState()
  private var closed = false
  let recorder: RealtimeVideoRecorder
  let consumer: RealtimeMediaFrameConsumer

  init() {
    let failure = failure
    let recorder = RealtimeVideoRecorder { error in failure.write(error.localizedDescription) }
    self.recorder = recorder
    consumer = RealtimeMediaFrameConsumer { frame in recorder.append(frame) }
  }

  func status() -> String? { failure.read() }

  /// Obtains add-only photo access before accepting frames for a new recording.
  func start() async throws {
    let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard status == .authorized || status == .limited else {
      throw NSError(domain: "record.permission", code: 1)
    }
    try lock.withLock {
      guard !closed else { throw NSError(domain: "record.notRecording", code: 1) }
      failure.write(nil)
      try recorder.start()
    }
  }

  /// Finalizes the MP4 and saves it to Photos, including when the screen leaves the foreground.
  func stopAndSave() async throws -> String {
    let backgroundTask = await MainActor.run {
      UIApplication.shared.beginBackgroundTask(withName: "XLab recording")
    }
    defer {
      Task { @MainActor in
        if backgroundTask != .invalid {
          UIApplication.shared.endBackgroundTask(backgroundTask)
        }
      }
    }
    let url = try await recorder.stop()
    defer { try? FileManager.default.removeItem(at: url) }
    var identifier: String?
    try await PHPhotoLibrary.shared().performChanges {
      identifier =
        PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)?
        .placeholderForCreatedAsset?.localIdentifier
    }
    guard let identifier else { throw NSError(domain: "record.saveFailed", code: 1) }
    return identifier
  }

  func close() {
    lock.withLock { closed = true }
    consumer.invalidate()
    recorder.cancel()
  }
}

/// Bridges recording controls and completion status; pixel buffers and PCM remain native.
@objc(XLabRemoteMediaFrames)
final class XLabRemoteMediaFrames: NSObject, RCTInvalidating {
  private let lock = NSLock()
  private var receivers: [String: XLabRemoteMediaFrameReceiver] = [:]
  private var invalidated = false

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  @objc(createConsumer:reject:)
  func createConsumer(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    let receiver = lock.withLock { () -> XLabRemoteMediaFrameReceiver? in
      guard !invalidated else { return nil }
      let receiver = XLabRemoteMediaFrameReceiver()
      receivers[receiver.consumer.nativeHandle] = receiver
      return receiver
    }
    guard let receiver else {
      reject("MEDIA_ERROR", "record.failed", nil)
      return
    }
    resolve(receiver.consumer.nativeHandle)
  }

  @objc(startRecording:resolve:reject:)
  func startRecording(
    _ handle: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let receiver = lock.withLock({ receivers[handle] }) else {
      reject("MEDIA_ERROR", "record.notRecording", nil)
      return
    }
    Task {
      do { try await receiver.start(); resolve(nil) } catch {
        reject("MEDIA_ERROR", Self.failureKey(error), nil)
      }
    }
  }

  @objc(stopRecording:resolve:reject:)
  func stopRecording(
    _ handle: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let receiver = lock.withLock({ receivers[handle] }) else {
      reject("MEDIA_ERROR", "record.notRecording", nil)
      return
    }
    Task {
      do { resolve(try await receiver.stopAndSave()) } catch {
        reject("MEDIA_ERROR", Self.failureKey(error), nil)
      }
    }
  }

  @objc(getRecordingError:resolve:reject:)
  func getRecordingError(
    _ handle: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    resolve(lock.withLock { receivers[handle]?.status() })
  }

  @objc(releaseConsumer:resolve:reject:)
  func releaseConsumer(
    _ handle: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    lock.withLock { receivers.removeValue(forKey: handle) }?.close()
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
    for receiver in previous { receiver.close() }
  }

  private static func failureKey(_ error: Error) -> String {
    if let error = error as? RealtimeVideoRecorder.RecorderError {
      return error.localizedDescription
    }
    let domain = (error as NSError).domain
    return domain.hasPrefix("record.") ? domain : "record.failed"
  }
}
