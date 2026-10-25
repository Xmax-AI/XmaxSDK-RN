//
//  RealtimeMediaFrameConsumer.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Foundation

/// An app-owned native receiver for remote PCM and video packets.
/// Retain the consumer, pass its nativeHandle to JavaScript, and invalidate it after removing the
/// manager's listener. Frames never cross the JavaScript bridge. Callbacks run on the SDK's bounded
/// serial background queue; a callback already running may finish after invalidation.
public final class RealtimeMediaFrameConsumer: @unchecked Sendable {

  /// Protects the weak registry shared by native producers and JavaScript registrations.
  private static let registryLock = NSLock()

  /// The live receivers indexed by their nonreusable registration handles.
  nonisolated(unsafe) private static var registry: [String: WeakConsumer] = [:]

  /// A registry entry that does not extend the app's receiver lifetime.
  private final class WeakConsumer {

    /// The receiver retained by the integrating app.
    weak var value: RealtimeMediaFrameConsumer?

    /// Creates a weak receiver reference.
    init(
      _ value: RealtimeMediaFrameConsumer
    ) { self.value = value }
  }

  /// The opaque identity supplied as the TypeScript listener's nativeHandle.
  public let nativeHandle = UUID().uuidString

  /// Protects listener removal independently of callbacks already running.
  private let lock = NSLock()

  /// The application's current output callback; nil permanently disables this consumer.
  private var listener: RealtimeMediaFrameListener?

  /// Creates a native output receiver without starting observation or changing playback.
  ///
  /// - Parameter listener: The serialized background handler for owned media packets.
  public init(
    listener: @escaping RealtimeMediaFrameListener
  ) {
    self.listener = listener
    Self.registryLock.withLock { Self.registry[nativeHandle] = WeakConsumer(self) }
  }

  /// Removes the receiver from the native registry when its owner releases it.
  deinit { Self.registryLock.withLock { _ = Self.registry.removeValue(forKey: nativeHandle) } }

  /// Permanently rejects new callbacks without blocking one already running.
  public func invalidate() {
    lock.withLock { listener = nil }
    Self.registryLock.withLock { _ = Self.registry.removeValue(forKey: nativeHandle) }
  }

  /// Resolves a currently retained native receiver.
  ///
  /// - Parameter handle: The opaque identity passed from JavaScript.
  /// - Returns: The receiver, or nil after invalidation or owner release.
  static func find(
    _ handle: String
  ) -> RealtimeMediaFrameConsumer? {
    Self.registryLock.withLock { Self.registry[handle]?.value }
  }

  /// Invokes the current callback outside the receiver's state lock.
  ///
  /// - Parameter frame: The owned audio or video packet.
  func receive(
    _ frame: RealtimeMediaFrame
  ) {
    let callback = lock.withLock { listener }
    callback?(frame)
  }
}
