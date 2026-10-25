//
//  RemoteVideoTimeline.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

/**
 * Maps native monotonic video presentation times onto the receiver's Unix rendering clock.
 * Access is serialized by the owning RTC observer.
 */
internal class RemoteVideoTimeline(

  /**
   * Supplies the receiver's Unix time in milliseconds when anchoring a result binding.
   */
  private val unixTimeMs: () -> Long = System::currentTimeMillis,

  /**
   * Supplies the receiver's monotonic time in nanoseconds at the same anchor.
   */
  private val monotonicTimeNs: () -> Long = System::nanoTime
) {

  /**
   * The Unix timestamp of the active binding's clock anchor, in microseconds.
   */
  private var unixAnchorUs = 0L

  /**
   * The monotonic timestamp paired with the Unix anchor, in nanoseconds.
   */
  private var monotonicAnchorNs = 0L

  /**
   * Anchors a new result binding without changing its clock mapping on each frame.
   */
  fun reset() {
    unixAnchorUs = Math.multiplyExact(unixTimeMs(), 1000)
    monotonicAnchorNs = monotonicTimeNs()
  }

  /**
   * Preserves valid rendering time or maps a native nanosecond presentation time to the same clock.
   *
   * @param renderTimeMs The native Unix rendering time, or a nonpositive value when unavailable.
   * @param timestampNs The native monotonic video presentation timestamp, in nanoseconds.
   * @return The receiver presentation time in microseconds, or null for an invalid timestamp.
   */
  fun presentationTimeUs(
    renderTimeMs: Long,
    timestampNs: Long
  ): Long? {
    if (renderTimeMs > 0) return if (renderTimeMs <= Long.MAX_VALUE / 1000) renderTimeMs * 1000 else null
    if (timestampNs < 1000 || unixAnchorUs <= 0 || monotonicAnchorNs <= 0) return null
    return try {
      Math.addExact(unixAnchorUs, Math.subtractExact(timestampNs, monotonicAnchorNs) / 1000)
        .takeIf { it > 0 }
    } catch (_: ArithmeticException) { null }
  }
}
