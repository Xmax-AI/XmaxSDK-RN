//
//  XmaxFileCommit.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Darwin
import Foundation

/// An operation that atomically replaces a completed download in the same directory without first
/// deleting the destination.
enum XmaxFileCommit {

  /// The serial file queue that commits storage downloads.
  static let queue = DispatchQueue(
    label: "ai.xmax.storage.commit",
    qos: .utility
  )

  /// Atomically replaces the destination with a completed regular temporary file in the same
  /// directory, preserving the original destination on failure.
  ///
  /// - Parameters:
  ///   - sourcePath: The absolute path of the completed temporary file.
  ///   - destinationPath: The absolute destination path in the temporary file's directory.
  ///
  /// - Throws: An operation error caused by invalid parameters or unavailable native resources.
  static func replace(
    _ sourcePath: String,
    destinationPath: String
  ) throws {
    guard sourcePath.hasPrefix("/"), destinationPath.hasPrefix("/"),
      !sourcePath.contains("\0"), !destinationPath.contains("\0")
    else {
      throw CocoaError(.fileWriteInvalidFileName)
    }

    let source = URL(fileURLWithPath: sourcePath).standardizedFileURL
    let destination = URL(fileURLWithPath: destinationPath).standardizedFileURL
    guard source != destination,
      source.deletingLastPathComponent() == destination.deletingLastPathComponent(),
      try source.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true
    else {
      throw CocoaError(.fileWriteInvalidFileName)
    }

    let result = source.path.withCString { sourcePointer in
      destination.path.withCString { destinationPointer in
        Darwin.rename(
          sourcePointer,
          destinationPointer
        )
      }
    }
    if result != 0 {
      throw NSError(
        domain: NSPOSIXErrorDomain,
        code: Int(errno)
      )
    }
  }
}
