//
//  XmaxImageVideoFormat.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

/**
 * The validation rules for native frame dimensions, integer bounds, and image frame rates.
 */
internal object XmaxImageVideoFormat {

  /**
   * Validates positive dimensions within native integer bounds and a frame rate from 1 to 60 fps.
   *
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   * @param fps The frame rate, in fps.
   */
  fun isValid(
    width: Double,
    height: Double,
    fps: Double
  ): Boolean =
    listOf(
      width,
      height
    ).all {
      it.isFinite() && it > 0 && it % 1 == 0.0 && it <= Int.MAX_VALUE.toDouble()
    } && fps.isFinite() && fps > 0 && fps % 1 == 0.0 && fps <= 60
}
