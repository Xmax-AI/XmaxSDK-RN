import Foundation
import React
import XmaxReactNativeSDK

/// Bridges XLab's file decoder lifecycle; decoded pixels and PCM stay on native queues.
@objc(XLabExternalCapture)
final class XLabExternalCapture: NSObject, RCTInvalidating, @unchecked Sendable {
  @MainActor
  private var sources: [String: RealtimeFileVideoSource] = [:]

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  @objc(prepare:fps:resolve:reject:)
  func prepare(
    _ fileURL: String,
    fps: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task { @MainActor in
      do {
        guard fps.isFinite, fps > 0, fps <= 120, fps.rounded(.down) == fps,
          let url = URL(string: fileURL), url.isFileURL
        else {
          throw NSError(domain: "XLab.ExternalCapture", code: 1)
        }
        let source = try await RealtimeFileVideoSource.make(fileURL: url, frameRate: Int(fps))
        let id = UUID().uuidString
        sources[id] = source
        resolve([
          "sourceID": id, "width": source.videoFormat.width, "height": source.videoFormat.height,
          "fps": source.videoFormat.fps, "hasAudio": source.hasAudio,
        ])
      } catch { reject("MEDIA_ERROR", "Unable to prepare external video", error) }
    }
  }

  @objc(start:sink:resolve:reject:)
  func start(
    _ sourceID: String,
    sink: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task { @MainActor in
      do {
        guard let source = sources[sourceID], let receiver = RealtimeExternalFrameSink.find(sink)
        else {
          throw NSError(domain: "XLab.ExternalCapture", code: 2)
        }
        try await source.start(sink: receiver)
        resolve(nil)
      } catch { reject("MEDIA_ERROR", "Unable to start external video", error) }
    }
  }

  @objc(stop:resolve:reject:)
  func stop(
    _ sourceID: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task { @MainActor in
      await sources.removeValue(forKey: sourceID)?.stop()
      resolve(nil)
    }
  }

  @objc
  func invalidate() {
    Task { @MainActor in
      let previous = sources.values
      sources.removeAll()
      for source in previous { await source.stop() }
    }
  }
}
