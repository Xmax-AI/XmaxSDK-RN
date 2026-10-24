//
//  XmaxImageVideoFormat.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/// The validation rules for native frame dimensions, integer bounds, and image frame rates.
enum XmaxImageVideoFormat {

  /// Validates positive dimensions within native integer bounds and a frame rate from 1 to 60 fps.
  ///
  /// - Parameters:
  ///   - width: The width, in pixels.
  ///   - height: The height, in pixels.
  ///   - fps: The frame rate, in fps.
  static func isValid(
    width: Double,
    height: Double,
    fps: Double
  ) -> Bool {
    [width, height].allSatisfy {
      $0.isFinite && $0 > 0 && $0.rounded(.down) == $0 && $0 <= Double(Int32.max)
    } && fps.isFinite && fps > 0 && fps.rounded(.down) == fps && fps <= 60
  }
}
