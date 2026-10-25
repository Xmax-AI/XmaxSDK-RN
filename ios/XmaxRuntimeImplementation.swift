//
//  XmaxRuntimeImplementation.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import AVFoundation
import Foundation
@preconcurrency import React
@preconcurrency import UIKit
@preconcurrency import AgoraRtcKit

/// A runtime that manages media leases, permissions, image copies, file replacement, and operations
/// on mount-validated views.
@objc(XmaxRuntimeImplementation)
public final class XmaxRuntimeImplementation: NSObject, @unchecked Sendable {
  // MARK: - Native Services

  /// The resource lock shared by media startup, frame submission, and release.
  private let gate = NSRecursiveLock()

  /// The service for native image metadata, conversion, and copy ownership.
  private let images = XmaxImageManager()

  /// The RTC adapter operating under the current media lease.
  private var rtc = XmaxAgoraEngine()

  /// The React Native callback receiving serialized RTC events.
  @objc
  public var eventSink: ((String) -> Void)?

  /// The native image frame source, which must stop before RTC engine destruction.
  private let imageVideo: XmaxImageVideoSource

  /// The serialized platform, operating system, and device metadata.
  private let metadata: String

  // MARK: - Media Ownership

  /// The exclusive resource identifier; stale identifiers cannot release replacement resources.
  private var owner: String?

  /// Whether the current media lease still accepts native operations.
  private var active = false

  /// Whether the application currently permits acquisition of foreground media resources.
  private var foreground = false

  /// Whether the native resource manager has been permanently invalidated.
  private var invalidated = false

  // MARK: - Initialization

  /// Creates native media services and device metadata without starting capture.
  public override init() {
    imageVideo = XmaxImageVideoSource(gate: gate)

    // Codegen may create instances on the JavaScript thread; metadata reads must not access UIKit.
    var info = utsname()
    uname(&info)

    let model = withUnsafeBytes(of: &info.machine) {
      String(
        decoding: $0.prefix { $0 != 0 },
        as: UTF8.self
      )
    }

    let version = ProcessInfo.processInfo.operatingSystemVersion
    var components = [version.majorVersion, version.minorVersion]

    if version.patchVersion != 0 {
      components.append(version.patchVersion)
    }

    let data = try! JSONSerialization.data(withJSONObject: [
      "platform": "ios",
      "os_version": components.map(String.init).joined(separator: "."),
      "device_model": model,
    ])
    metadata = String(
      decoding: data,
      as: UTF8.self
    )

    super.init()

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(didEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(willEnterForeground),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )
  }

  /// Hides the validated result container before cleaning up the room or canvas.
  ///
  /// - Parameter view: The native video container whose mount identifier has been validated by the
  ///   runtime.
  @MainActor
  @objc(hideVideoContainer:)
  public func hideVideoContainer(
    _ view: UIView
  ) {
    // Keeps native visibility consistent with React opacity so Fabric can safely reuse the container.
    view.layer.opacity = 0
  }

  // MARK: - Runtime Lifecycle

  /// Refreshes the foreground state before requesting a native media lease.
  ///
  /// Completes after the foreground state refresh; failures reject the Promise with an SDK error
  /// code.
  ///
  /// - Parameters:
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @objc(prepareRuntime:reject:)
  public func prepareRuntime(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let promise = XmaxNativePromise(
      resolve: resolve,
      reject: reject
    )

    DispatchQueue.main.async {
      let isForeground = UIApplication.shared.applicationState != .background

      self.gate.xmaxWithLock {
        guard !self.invalidated else {
          promise.reject(
            "Media runtime has been released",
            code: "CANCELLED"
          )
          return
        }

        self.foreground = isForeground

        promise.resolve()
      }
    }
  }

  /// Stops image frame submission and releases foreground RTC resources when the application enters
  /// the background.
  @objc
  private func didEnterBackground() {
    gate.xmaxWithLock {
      XmaxNativeLogger.write(
        "info",
        message: "[Xmax][Media] Background: releasing owned capture"
      )
      foreground = false

      if owner != nil && active {
        imageVideo.stop()
        active = false
        rtc.close()
      }
    }
  }

  /// Allows subsequent explicit media acquisition without automatically restarting stopped media.
  @objc
  private func willEnterForeground() {
    gate.xmaxWithLock {
      foreground = true
    }
  }

  /// Stops native work and releases current resources without cancelling caller-owned file or
  /// transfer operations.
  @objc
  public func invalidate() {
    NotificationCenter.default.removeObserver(self)

    gate.xmaxWithLock {
      invalidated = true
      imageVideo.stop()

      if owner != nil && active {
        rtc.close()
      }

      active = false
      owner = nil
    }

    images.invalidate()
    XmaxNativeLogger.configure(0)
  }

  // MARK: - Media Resource Ownership

  /// Acquires an exclusive foreground media lease if the runtime is valid and no other owner holds
  /// it.
  ///
  /// - Parameter token: The media ownership identifier; only the current valid owner may modify
  ///   resources.
  ///
  /// - Returns: Whether the exclusive foreground media lease was acquired.
  @objc(acquire:)
  public func acquire(
    _ token: String
  ) -> NSNumber {
    gate.xmaxWithLock {
      guard !invalidated, owner == nil, foreground else {
        return false
      }

      owner = token
      active = true

      return true
    }
  }

  /// Checks whether the specified identifier still owns valid media resources.
  ///
  /// - Parameter token: The media ownership identifier; only the current valid owner may modify
  ///   resources.
  @objc(isActive:)
  public func isActive(
    _ token: String
  ) -> NSNumber {
    gate.xmaxWithLock {
      NSNumber(value: owner == token && active)
    }
  }

  /// Releases only the matching media lease after capture and engine cleanup.
  ///
  /// - Parameter token: The media ownership identifier; only the current valid owner may modify
  ///   resources.
  @objc(release:)
  public func release(
    _ token: String
  ) {
    gate.xmaxWithLock {
      guard owner == token else {
        return
      }

      imageVideo.stop()

      // Normal closure destroys the engine; entering the background may release it earlier.
      active = false
      owner = nil
    }
  }

  // MARK: - Runtime Metadata

  /// Applies global log filtering to the native runtime and worker queues.
  ///
  /// - Parameter options: The SDK log-category bitmask; 0 disables logging.
  @objc(configureLogging:)
  public func configureLogging(
    _ options: Double
  ) {
    XmaxNativeLogger.configure(options)
  }

  /// Writes a formatted SDK log entry with the specified level and category.
  ///
  /// - Parameters:
  ///   - level: The log level: debug, info, warn, or error.
  ///   - message: The formatted log message.
  ///   - option: The current message's log-category bitmask.
  @objc(writeLog:message:option:)
  public func writeLog(
    _ level: String,
    message: String,
    option: Double
  ) {
    guard option.isFinite, (1...3).contains(option) else {
      return
    }

    XmaxNativeLogger.write(
      level,
      message: message,
      option: Int(option)
    )
  }

  /// Generates a unique identifier for a media owner, task, or image copy.
  @objc
  public func randomUUID() -> String {
    UUID().uuidString
  }

  /// Serializes the runtime platform, operating system version, and device model.
  @objc
  public func runtimeInfo() -> String {
    metadata
  }

  // MARK: - Media Permissions

  /// Requests one media permission without starting capture.
  ///
  /// - Parameters:
  ///   - permission: The camera or microphone permission to request.
  ///   - resolve: The callback receiving whether access is authorized.
  ///   - reject: The callback receiving invalid permission requests.
  @objc(requestMediaPermission:resolve:reject:)
  public func requestMediaPermission(
    _ permission: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let promise = XmaxNativePromise(
      resolve: resolve,
      reject: reject
    )
    guard permission == "camera" || permission == "microphone" else {
      promise.reject(
        "Invalid media permission",
        code: "INVALID_CONFIGURATION"
      )
      return
    }
    let media: AVMediaType = permission == "camera" ? .video : .audio
    let status = AVCaptureDevice.authorizationStatus(for: media)
    if status == .notDetermined {
      AVCaptureDevice.requestAccess(for: media) { allowed in promise.resolve(allowed) }
    } else {
      promise.resolve(status == .authorized)
    }
  }

  /// Replaces a completed download's destination file on the file queue independently of the
  /// realtime media lease.
  ///
  /// Completes after successful atomic replacement; failures reject the Promise with an SDK error
  /// code.
  ///
  /// - Parameters:
  ///   - sourcePath: The absolute path of the completed temporary file.
  ///   - destinationPath: The absolute destination path in the temporary file's directory.
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @objc(replaceFile:destinationPath:resolve:reject:)
  public func replaceFile(
    _ sourcePath: String,
    destinationPath: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let promise = XmaxNativePromise(
      resolve: resolve,
      reject: reject
    )
    XmaxFileCommit.queue.async {
      do {
        try XmaxFileCommit.replace(
          sourcePath,
          destinationPath: destinationPath
        )
        promise.resolve()
      } catch {
        promise.reject(
          "Unable to commit downloaded file",
          code: "DOWNLOAD_ERROR",
          error: error
        )
      }
    }
  }

  // MARK: - Image Copies

  /// Reads orientation-corrected local image dimensions without transferring pixels across the
  /// bridge.
  ///
  /// Resolves the Promise with JSON containing orientation-corrected dimensions; rejects failures
  /// with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The readable local file URL; your app retains ownership of the original.
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @objc(imageInfo:resolve:reject:)
  public func imageInfo(
    _ fileURL: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    images.info(
      fileURL,
      promise: XmaxNativePromise(
        resolve: resolve,
        reject: reject
      )
    )
  }

  /// Creates a private upright JPEG copy at the target dimensions without modifying the caller's
  /// original file.
  ///
  /// Resolves the Promise with the private JPEG URL; rejects failures with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The readable local file URL; your app retains ownership of the original.
  ///   - width: The width, in pixels.
  ///   - height: The height, in pixels.
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @objc(prepareImage:width:height:resolve:reject:)
  public func prepareImage(
    _ fileURL: String,
    width: Double,
    height: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    images.prepare(
      fileURL,
      width: width,
      height: height,
      promise: XmaxNativePromise(
        resolve: resolve,
        reject: reject
      )
    )
  }

  /// Deletes only SDK-owned image copies; an already absent copy is treated as successfully
  /// removed.
  ///
  /// Completes after copy cleanup; failures reject the Promise with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The SDK-owned private image copy URL returned by image preparation.
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @objc(removePreparedImage:resolve:reject:)
  public func removePreparedImage(
    _ fileURL: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    images.remove(
      fileURL,
      promise: XmaxNativePromise(
        resolve: resolve,
        reject: reject
      )
    )
  }

  // MARK: - RTC Adaptation

  /// Validates media ownership before executing a decoded RTC command on the UI thread.
  ///
  /// Resolves the Promise with the RTC operation's JSON result; rejects failures with an SDK error
  /// code.
  ///
  /// - Parameters:
  ///   - token: The media ownership identifier; only the current valid owner may modify resources.
  ///   - request: The RTC operation and parameters decoded and validated from a JavaScript request.
  ///   - resolve: The React Native Promise completion callback.
  ///   - reject: The React Native Promise failure callback.
  @MainActor
  @objc(rtcCommand:request:resolve:reject:)
  public func rtcCommand(
    _ token: String,
    request: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let promise = XmaxNativePromise(
      resolve: resolve,
      reject: reject
    )
    gate.xmaxWithLock {
      guard isActive(token).boolValue else {
        promise.reject(
          "Media lease is unavailable",
          code: "CANCELLED"
        )
        return
      }
      do {
        guard let data = request.data(using: .utf8),
          let command = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
          throw XmaxNativeFailure(message: "Invalid RTC command")
        }
        if command["operation"] as? String == "open" { rtc = XmaxAgoraEngine() }
        if command["operation"] as? String == "startImage" {
          guard let engine = rtc.engine else {
            throw XmaxNativeFailure(message: "RTC engine is unavailable")
          }
          imageVideo.start(
            engine: engine,
            path: command["path"] as? String ?? "",
            width: (command["width"] as? NSNumber)?.intValue ?? 0,
            height: (command["height"] as? NSNumber)?.intValue ?? 0,
            fps: (command["fps"] as? NSNumber)?.intValue ?? 0,
            active: { [weak self] in self?.isActive(token).boolValue == true },
            promise: promise
          )
          return
        }
        if ["pause", "close"].contains(command["operation"] as? String ?? "") { imageVideo.stop() }
        let value = try rtc.execute(
          owner: token,
          request: command,
          emit: { [weak self] in self?.eventSink?($0) }
        )
        promise.resolve(value)
      } catch {
        promise.reject(
          "RTC operation failed",
          code: "RTC_ERROR",
          error: error
        )
      }
    }
  }

  /// Registers an existing video container after validating its native mount identifier.
  ///
  /// - Parameters:
  ///   - view: The native video container whose mount identifier has been validated by the runtime.
  ///   - nativeID: The native mount identity excluding removed or recycled views.
  @MainActor
  @objc(registerVideoSurface:nativeID:)
  public func registerVideoSurface(
    _ view: UIView,
    nativeID: String
  ) {
    rtc.register(
      view,
      id: nativeID
    )
  }

  /// Removes only the specified video container's native registration.
  ///
  /// - Parameter nativeID: The native mount identity excluding removed or recycled views.
  @MainActor
  @objc(unregisterVideoSurface:)
  public func unregisterVideoSurface(
    _ nativeID: String
  ) { rtc.unregister(nativeID) }
}
