//
//  XmaxRemoteFrameObserver.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import io.agora.base.VideoFrame
import io.agora.rtc2.video.IVideoFrameObserver

/**
 * A one-shot observer of decoded result readiness without copying or exporting video frames.
 *
 * @param onReady Receives the account, room, and token for the next matching decoded frame.
 */
internal class XmaxRemoteFrameObserver(
  /**
   * The callback receiving one matching decoded frame's account, room, and observation token.
   */
  private val onReady: (Int, String, String) -> Unit
) : IVideoFrameObserver {

  /**
   * The lock protecting observations across RTC and command threads.
   */
  private val lock = Any()

  /**
   * The room, account, and token accepting the next decoded frame.
   */
  private var request: Request? = null

  /**
   * An observation accepting one frame from a specific result account.
   */
  private data class Request(
    /**
     * The RTC room containing the result.
     */
    val roomID: String,

    /**
     * The native result account identifier.
     */
    val uid: Int,

    /**
     * The generation observation token.
     */
    val token: String
  )

  /**
   * Observes the next matching decoded frame.
   *
   * @param roomID The RTC room containing the result.
   * @param uid The native result account identifier.
   * @param token The generation observation token rejecting retired notifications.
   */
  fun observe(
    roomID: String,
    uid: Int,
    token: String
  ) {
    synchronized(lock) {
      request = Request(
        roomID,
        uid,
        token
      )
    }
  }

  /**
   * Clears an observation without cancelling a newer request.
   *
   * @param token The observation to clear, or null to clear any observation.
   */
  fun clear(
    token: String? = null
  ) {
    synchronized(lock) {
      if (token == null || request?.token == token) request = null
    }
  }

  /**
   * Reports readiness once for a matching frame and preserves RTC rendering.
   *
   * @param channelId The RTC room containing the frame.
   * @param uid The native account publishing the frame.
   * @param frame The decoded frame owned by RTC for this callback.
   * @return True, preserving the unmodified frame.
   */
  override fun onRenderVideoFrame(
    channelId: String?,
    uid: Int,
    frame: VideoFrame?
  ): Boolean {
    if (channelId == null || frame == null || frame.buffer.width <= 0 || frame.buffer.height <= 0) return true
    val token = synchronized(lock) {
      val pending = request
      if (pending?.uid == uid && pending.roomID == channelId) {
        request = null
        pending.token
      } else null
    }
    if (token != null) onReady(
      uid,
      channelId,
      token
    )
    return true
  }

  /**
   * Requests read-only frame observation.
   *
   * @return The read-only processing mode.
   */
  override fun getVideoFrameProcessMode(): Int = IVideoFrameObserver.PROCESS_MODE_READ_ONLY

  /**
   * Retains the native decoded pixel format.
   *
   * @return The default native frame format.
   */
  override fun getVideoFormatPreference(): Int = IVideoFrameObserver.VIDEO_PIXEL_DEFAULT

  /**
   * Leaves frame rotation metadata unchanged.
   *
   * @return False, retaining RTC rotation handling.
   */
  override fun getRotationApplied(): Boolean = false

  /**
   * Leaves frame mirroring unchanged.
   *
   * @return False, retaining RTC mirroring handling.
   */
  override fun getMirrorApplied(): Boolean = false

  /**
   * Observes decoded frames before rendering without requiring a mounted view.
   *
   * @return The pre-render observation position.
   */
  override fun getObservedFramePosition(): Int = IVideoFrameObserver.POSITION_PRE_RENDERER

  /**
   * Preserves capture frames outside the selected observation position.
   *
   * @param sourceType The native capture source.
   * @param frame The captured frame.
   *
   * @return True, preserving the frame.
   */
  override fun onCaptureVideoFrame(
    sourceType: Int,
    frame: VideoFrame?
  ): Boolean = true

  /**
   * Preserves encoder frames outside the selected observation position.
   *
   * @param sourceType The native video source.
   * @param frame The frame before encoding.
   *
   * @return True, preserving the frame.
   */
  override fun onPreEncodeVideoFrame(
    sourceType: Int,
    frame: VideoFrame?
  ): Boolean = true

  /**
   * Preserves media-player frames without observing them.
   *
   * @param frame The media-player frame.
   * @param mediaPlayerId The native player identifier.
   *
   * @return True, preserving the frame.
   */
  override fun onMediaPlayerVideoFrame(
    frame: VideoFrame?,
    mediaPlayerId: Int
  ): Boolean = true
}
