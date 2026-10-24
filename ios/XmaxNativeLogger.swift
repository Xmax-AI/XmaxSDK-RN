//
//  XmaxNativeLogger.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Foundation
import OSLog

/// A logger that filters SDK entries by category before writing native output.
final class XmaxNativeLogger: @unchecked Sendable {

  /// The shared native runtime log filtering settings.
  private static let state = XmaxNativeLogger()

  /// The lock protecting log configuration across threads.
  private let gate = NSLock()

  /// The enabled log category bitmask; 0 disables logging.
  private var options = 0

  /// The structured native output for SDK logs.
  private let logger = Logger(
    subsystem: "ai.xmax.XmaxSDK",
    category: "XmaxSDK"
  )

  /// Replaces the global native log category bitmask.
  ///
  /// - Parameter options: The SDK log-category bitmask; 0 disables logging.
  static func configure(
    _ options: Double
  ) {
    state.gate.lock()
    defer {
      state.gate.unlock()
    }

    state.options = options.isFinite && (0...3).contains(options) ? Int(options) : 0
  }

  /// Writes an enabled, formatted SDK log entry without triggering a JavaScript console error.
  ///
  /// - Parameters:
  ///   - level: The log level: debug, info, warn, or error.
  ///   - message: The formatted log message.
  ///   - option: The current message's log-category bitmask.
  static func write(
    _ level: String,
    message: String,
    option: Int = 1
  ) {
    state.gate.lock()
    defer {
      state.gate.unlock()
    }

    guard option > 0, state.options & option == option else {
      return
    }

    switch level {
    case "debug":
      state.logger.debug("\(message, privacy: .public)")
    case "info":
      state.logger.info("\(message, privacy: .public)")
    case "warn":
      state.logger.warning("\(message, privacy: .public)")
    case "error":
      state.logger.error("\(message, privacy: .public)")
    default:
      return
    }
  }
}
