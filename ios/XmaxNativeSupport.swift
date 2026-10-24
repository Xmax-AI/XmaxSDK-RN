//
//  XmaxNativeSupport.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Foundation
@preconcurrency import React

/// An extension that serializes resource access and supports reentrant lifecycle checks.
extension NSRecursiveLock {

  /// Executes an operation under the recursive lock and releases the lock on both success and
  /// failure.
  ///
  /// - Parameter operation: The operation to execute while holding the lock.
  ///
  /// - Returns: The operation result.
  ///
  /// - Throws: The error thrown by the operation.
  func xmaxWithLock<T>(
    _ operation: () throws -> T
  ) rethrows -> T {
    lock()
    defer {
      unlock()
    }

    return try operation()
  }
}

/// A wrapper that retains React Native Promise callbacks until an asynchronous native operation
/// completes.
final class XmaxNativePromise: @unchecked Sendable {

  /// The callback that resolves the JavaScript Promise.
  private let resolveBlock: RCTPromiseResolveBlock

  /// The callback that rejects the JavaScript Promise.
  private let rejectBlock: RCTPromiseRejectBlock

  /// Retains the completion and failure callbacks for one JavaScript Promise.
  init(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolveBlock = resolve
    rejectBlock = reject
  }

  /// Resolves the JavaScript Promise with the expected result representation.
  ///
  /// - Parameter value: The result passed to JavaScript; defaults to nil for no result value.
  func resolve(
    _ value: Any? = nil
  ) {
    resolveBlock(value)
  }

  /// Rejects the JavaScript Promise with a stable SDK error code and native error details.
  ///
  /// - Parameters:
  ///   - message: The error description delivered to JavaScript.
  ///   - code: The JavaScript error code; defaults to MEDIA_ERROR.
  ///   - error: The native error details.
  func reject(
    _ message: String,
    code: String = "MEDIA_ERROR",
    error: Error? = nil
  ) {
    rejectBlock(
      code,
      message,
      error
    )
  }
}

/// A native operation error exposing a description through the SDK error interface.
struct XmaxNativeFailure: LocalizedError {

  /// The native error description exposed through the SDK error interface.
  let message: String

  /// The localized description required by the native error protocol.
  var errorDescription: String? {
    message
  }
}
