//
//  XmaxImageManager.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Foundation
import ImageIO
@preconcurrency import UIKit

/// A service that reads image metadata and manages private upright copies without deleting
/// caller-owned originals.
final class XmaxImageManager: @unchecked Sendable {

  /// The lock protecting image copy ownership and invalidation state.
  private let gate = NSRecursiveLock()

  /// The image copy paths created and eligible for cleanup by this service.
  private var owned = Set<URL>()

  /// Whether the native resource manager has been permanently invalidated.
  private var invalidated = false

  /// The private cache directory containing only SDK image copies.
  static var directory: URL {
    FileManager.default.urls(
      for: .cachesDirectory,
      in: .userDomainMask
    )[0]
    .appendingPathComponent(
      "xmax-images",
      isDirectory: true
    )
  }

  /// Validates a local file URL or absolute path before reading native image metadata.
  ///
  /// - Parameter value: The readable local file URL, absolute path, or supported content URI.
  ///
  /// - Returns: The validated absolute local file URL.
  private static func localURL(
    _ value: String
  ) -> URL? {
    let url = value.hasPrefix("/") ? URL(fileURLWithPath: value) : URL(string: value)

    return url?.isFileURL == true ? url : nil
  }

  /// Opens a validated native image source without modifying the caller's original file.
  ///
  /// - Parameter value: The readable local file URL, absolute path, or supported content URI.
  ///
  /// - Returns: The native image source opened from the local file.
  private static func source(
    _ value: String
  ) -> CGImageSource? {
    guard let url = localURL(value) else {
      return nil
    }

    return CGImageSourceCreateWithURL(
      url as CFURL,
      [kCGImageSourceShouldCache: false] as CFDictionary
    )
  }

  /// Asynchronously reads orientation-corrected dimensions without transferring image pixels to
  /// JavaScript.
  ///
  /// Resolves the Promise with JSON containing orientation-corrected dimensions; rejects failures
  /// with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The readable local file URL; your app retains ownership of the original.
  ///   - promise: The React Native Promise resolved or rejected when the asynchronous native
  ///     operation completes.
  func info(
    _ fileURL: String,
    promise: XmaxNativePromise
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        guard let source = Self.source(fileURL),
          let properties = CGImageSourceCopyPropertiesAtIndex(
            source,
            0,
            nil
          ) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0
        else {
          promise.reject("Unable to read local image dimensions")
          return
        }

        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        let rotated = (5...8).contains(orientation)
        let size = ["width": rotated ? height : width, "height": rotated ? width : height]

        do {
          let data = try JSONSerialization.data(withJSONObject: size)
          promise.resolve(
            String(
              decoding: data,
              as: UTF8.self
            )
          )
        } catch {
          promise.reject(
            "Unable to read local image dimensions",
            error: error
          )
        }
      }
    }
  }

  /// Creates a private upright JPEG at the target dimensions and records ownership for subsequent
  /// cleanup.
  ///
  /// Resolves the Promise with the private JPEG URL; rejects failures with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The readable local file URL; your app retains ownership of the original.
  ///   - width: The width, in pixels.
  ///   - height: The height, in pixels.
  ///   - promise: The React Native Promise resolved or rejected when the asynchronous native
  ///     operation completes.
  func prepare(
    _ fileURL: String,
    width: Double,
    height: Double,
    promise: XmaxNativePromise
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        // MediaService must calculate model format and pixel limits before preparation.
        guard width.isFinite, height.isFinite, width > 0, height > 0,
          width.rounded(.down) == width, height.rounded(.down) == height
        else {
          promise.reject("Invalid prepared image dimensions")
          return
        }

        guard let source = Self.source(fileURL) else {
          promise.reject("Unable to open local image")
          return
        }

        let options: [CFString: Any] = [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceShouldCacheImmediately: true,
          kCGImageSourceThumbnailMaxPixelSize: 4096,
        ]
        guard
          let decoded = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            options as CFDictionary
          )
        else {
          promise.reject("Unable to decode local image")
          return
        }

        let image = UIImage(cgImage: decoded)
        let scale = max(width / image.size.width, height / image.size.height)
        let target = CGRect(
          x: (width - image.size.width * scale) / 2,
          y: (height - image.size.height * scale) / 2,
          width: image.size.width * scale,
          height: image.size.height * scale
        )

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(
          size: CGSize(
            width: width,
            height: height
          ),
          format: format
        )
        let data = renderer.jpegData(withCompressionQuality: 0.95) { context in
          UIColor.black.setFill()
          context.fill(
            CGRect(
              x: 0,
              y: 0,
              width: width,
              height: height
            )
          )
          image.draw(in: target)
        }

        let output = Self.directory.appendingPathComponent(UUID().uuidString + ".jpg")

        do {
          try FileManager.default.createDirectory(
            at: Self.directory,
            withIntermediateDirectories: true
          )
          try data.write(
            to: output,
            options: .atomic
          )
        } catch {
          try? FileManager.default.removeItem(at: output)
          promise.reject(
            "Unable to save prepared image",
            error: error
          )
          return
        }

        self.gate.xmaxWithLock {
          guard !self.invalidated else {
            try? FileManager.default.removeItem(at: output)
            promise.reject("Image runtime has been released")
            return
          }

          self.owned.insert(output)

          promise.resolve(output.absoluteString)
        }
      }
    }
  }

  /// Deletes only image copies owned by this service; an already absent copy is treated as
  /// successfully removed.
  ///
  /// Completes after copy cleanup; failures reject the Promise with an SDK error code.
  ///
  /// - Parameters:
  ///   - fileURL: The SDK-owned private image copy URL returned by image preparation.
  ///   - promise: The React Native Promise resolved or rejected when the asynchronous native
  ///     operation completes.
  func remove(
    _ fileURL: String,
    promise: XmaxNativePromise
  ) {
    DispatchQueue.global(qos: .utility).async {
      guard let url = Self.localURL(fileURL)?.resolvingSymlinksInPath(),
        url.deletingLastPathComponent().path == Self.directory.resolvingSymlinksInPath().path,
        url.pathExtension == "jpg"
      else {
        promise.reject("Refusing to remove an image outside SDK cache")
        return
      }

      do {
        try FileManager.default.removeItem(at: url)
      } catch let error as NSError
        where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError
      {
        // An already deleted file is treated as successfully removed.
      } catch {
        promise.reject(
          "Unable to remove prepared image",
          error: error
        )
        return
      }

      self.gate.xmaxWithLock {
        if let original = Self.localURL(fileURL) {
          self.owned.remove(original)
        }
      }

      promise.resolve()
    }
  }

  /// Stops native work and releases current resources without cancelling caller-owned file or
  /// transfer operations.
  func invalidate() {
    gate.xmaxWithLock {
      invalidated = true

      for url in owned {
        try? FileManager.default.removeItem(at: url)
      }

      owned.removeAll()
    }
  }
}
