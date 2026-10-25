//
//  XmaxVideoTextureView.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.content.Context
import android.view.TextureView
import android.view.View

/**
 * A native video surface that fills its React-managed container.
 * Follows container size changes and removes its layout observer when detached.
 *
 * @param context The context of the video container.
 */
internal class XmaxVideoTextureView(
  context: Context,
) : TextureView(context), View.OnLayoutChangeListener {

  /**
   * The attached container whose size determines the rendering surface dimensions.
   */
  private var container: View? = null

  /**
   * Observes the current container and sizes the surface before video rendering begins.
   */
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    container = parent as? View
    container?.addOnLayoutChangeListener(this)
    layoutInContainer()
  }

  /**
   * Removes the layout observer before releasing the attached rendering surface.
   */
  override fun onDetachedFromWindow() {
    container?.removeOnLayoutChangeListener(this)
    container = null
    super.onDetachedFromWindow()
  }

  /**
   * Updates surface bounds after the React container changes size.
   *
   * @param view The container whose layout changed.
   * @param left The new left edge, in pixels.
   * @param top The new top edge, in pixels.
   * @param right The new right edge, in pixels.
   * @param bottom The new bottom edge, in pixels.
   * @param oldLeft The previous left edge, in pixels.
   * @param oldTop The previous top edge, in pixels.
   * @param oldRight The previous right edge, in pixels.
   * @param oldBottom The previous bottom edge, in pixels.
   */
  override fun onLayoutChange(
    view: View,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    oldLeft: Int,
    oldTop: Int,
    oldRight: Int,
    oldBottom: Int,
  ) {
    if (view === container) layoutInContainer()
  }

  /**
   * Measures and positions the video surface within the current container bounds.
   */
  private fun layoutInContainer() {
    val host = container ?: return
    measure(
      MeasureSpec.makeMeasureSpec(
        host.width,
        MeasureSpec.EXACTLY
      ),
      MeasureSpec.makeMeasureSpec(
        host.height,
        MeasureSpec.EXACTLY
      )
    )
    layout(
      0,
      0,
      host.width,
      host.height
    )
  }
}
