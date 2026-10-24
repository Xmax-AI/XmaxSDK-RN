//
//  XmaxCameraFrameLayout.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

/**
 * An integer crop rectangle calculated from the source and target aspect ratios.
 *
 * @constructor Creates a crop rectangle in source pixel coordinates.
 */
internal data class XmaxCameraFrameLayout(

  /**
   * The horizontal crop origin within the source image, in pixels.
   */
  val x: Int,

  /**
   * The vertical crop origin within the source image, in pixels.
   */
  val y: Int,

  /**
   * The native image or crop rectangle width, in pixels.
   */
  val width: Int,

  /**
   * The native image or crop rectangle height, in pixels.
   */
  val height: Int
) {

  /**
   * A calculator for centered crop rectangles that does not acquire camera or RTC resources.
   */
  companion object {

    /**
     * Calculates a centered integer crop rectangle for the target aspect ratio.
     *
     * @param width The source frame width, in pixels; must be even and at least 2.
     * @param height The source frame height, in pixels; must be even and at least 2.
     * @param targetWidth The target width, in pixels; must be even and at least 2.
     * @param targetHeight The target height, in pixels; must be even and at least 2.
     * @return The centered, even-aligned crop rectangle; integer rounding may affect its aspect
     *   ratio.
     * @throws IllegalArgumentException An error if any dimension is odd or less than 2.
     */
    fun crop(
      width: Int,
      height: Int,
      targetWidth: Int,
      targetHeight: Int
    ): XmaxCameraFrameLayout {
      require(
        listOf(
          width,
          height,
          targetWidth,
          targetHeight
        ).all { it >= 2 && it % 2 == 0 }
      )
      val cropWidth: Int
      val cropHeight: Int
      if (width.toLong() * targetHeight > height.toLong() * targetWidth) {
        cropWidth = ((height.toLong() * targetWidth / targetHeight).toInt() / 2 * 2).coerceAtLeast(2)
        cropHeight = height
      } else {
        cropWidth = width
        cropHeight = ((width.toLong() * targetHeight / targetWidth).toInt() / 2 * 2).coerceAtLeast(2)
      }
      return XmaxCameraFrameLayout(
        (width - cropWidth) / 4 * 2,
        (height - cropHeight) / 4 * 2,
        cropWidth,
        cropHeight,
      )
    }
  }
}
