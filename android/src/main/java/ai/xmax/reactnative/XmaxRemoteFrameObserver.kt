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
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Observes decoded readiness and requested native media without changing RTC rendering.
 *
 * @param videoTimeline Maps native video presentation time onto the shared rendering clock.
 * @param onReady Receives the account, room, and token for the next matching decoded frame.
 */
internal class XmaxRemoteFrameObserver(

  /**
   * Maps missing video render times onto the audio rendering clock for the active binding.
   */
  private val videoTimeline: RemoteVideoTimeline = RemoteVideoTimeline(),

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
   * The bounded output queue shared by remote PCM and video.
   */
  private val dispatcher = RealtimeMediaFrameDispatcher()

  /**
   * The current result user and shared audio/video binding identity.
   */
  private var output: Request? = null

  /**
   * Configures native output independently of first-frame readiness.
   *
   * @param consumer The app receiver, or null to remove queued output.
   * @param roomID The current RTC room.
   * @param uid The native result account.
   * @param streamID The nonreusable result binding identity.
   */
  fun setOutput(
    consumer: RealtimeMediaFrameConsumer?,
    roomID: String = "",
    uid: Int = 0,
    streamID: String? = null
  ) {
    synchronized(lock) {
      if (output?.token != streamID && consumer != null && streamID != null) videoTimeline.reset()
      output = if (consumer != null && streamID != null) Request(
        roomID,
        uid,
        streamID
      ) else null
      dispatcher.configure(
        consumer,
        streamID
      )
    }
  }

  /**
   * Retires queued output and its worker before engine destruction.
   */
  fun close() {
    clear()
    setOutput(null)
    dispatcher.close()
  }

  /**
   * Copies valid pre-mix PCM while its borrowed native buffer is still valid.
   *
   * @param channel The room supplying the packet.
   * @param uid The native result account.
   * @param samples The samples in each channel.
   * @param bytesPerSample The PCM sample size; only two-byte samples are accepted.
   * @param channels The interleaved channel count.
   * @param sampleRate The sample rate, in hertz.
   * @param buffer The borrowed PCM bytes, copied before returning.
   * @param renderTimeMs The receiver rendering timestamp, in milliseconds.
   */
  fun audio(
    channel: String?,
    uid: Int,
    samples: Int,
    bytesPerSample: Int,
    channels: Int,
    sampleRate: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long
  ) {
    val target = synchronized(lock) { output?.takeIf { it.roomID == channel && it.uid == uid } } ?: return
    if (bytesPerSample != 2 || channels !in 1..2 || sampleRate !in 8000..192000 || samples !in 1..192000 ||
      renderTimeMs <= 0 || renderTimeMs > Long.MAX_VALUE / 1000 || buffer == null || buffer.remaining() < samples * channels * 2) {
      dispatcher.discard(
        true,
        target.token
      )
      return
    }
    val data = ByteArray(samples * channels * 2)
    buffer.duplicate().get(data)
    dispatcher.audio(
      RealtimeAudioFrame(
        ByteBuffer.wrap(data).asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN),
        sampleRate,
        channels,
        samples,
        renderTimeMs * 1000
      ),
      target.token
    )
  }

  /**
   * Copies a padded native image plane into owned, tightly packed read-only storage.
   *
   * @param input The callback-borrowed image plane.
   * @param stride The source row stride, in bytes.
   * @param width The bytes copied per row.
   * @param height The number of rows.
   */
  private fun copyPlane(
    input: ByteBuffer,
    stride: Int,
    width: Int,
    height: Int
  ): ByteBuffer {
    val data = ByteArray(width * height)
    val source = input.duplicate()
    val origin = source.position()
    for (row in 0 until height) {
      source.position(origin + row * stride)
      source.get(
        data,
        row * width,
        width
      )
    }
    return ByteBuffer.wrap(data).asReadOnlyBuffer()
  }

  /**
   * A native result account binding with a nonreusable observation or output identity.
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
     * The first-frame observation or continuous output binding identity.
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
   * Maps the native monotonic presentation timestamp to the Unix rendering clock when render-start
   * time is unavailable.
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
    val target = synchronized(lock) { output?.takeIf { it.uid == uid && it.roomID == channelId } }
    if (target != null) {
      val renderTime = frame.renderStartTimeMs
      val presentationTimeUs = synchronized(lock) {
        videoTimeline.presentationTimeUs(renderTime, frame.timestampNs)
      }
      if (presentationTimeUs == null) {
        dispatcher.discard(
          false,
          target.token
        )
      } else {
        val image = frame.buffer.toI420()
        if (image == null) dispatcher.discard(
          false,
          target.token
        )
        else try {
          val width = image.width
          val height = image.height
          dispatcher.video(
            RealtimeVideoFrame(
              width,
              height,
              copyPlane(
                image.dataY,
                image.strideY,
                width,
                height
              ),
              copyPlane(
                image.dataU,
                image.strideU,
                (width + 1) / 2,
                (height + 1) / 2
              ),
              copyPlane(
                image.dataV,
                image.strideV,
                (width + 1) / 2,
                (height + 1) / 2
              ),
              frame.rotation,
              presentationTimeUs
            ),
            target.token
          )
        } catch (_: Exception) {
          dispatcher.discard(
            false,
            target.token
          )
        } finally { image.release() }
      }
    }
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
