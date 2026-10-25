//
//  RealtimeExternalFrameSink.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.media.Image
import io.agora.base.JavaI420Buffer
import io.agora.base.VideoFrame
import io.agora.base.internal.video.YuvHelper
import io.agora.rtc2.Constants
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.audio.AudioTrackConfig
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

/**
 * The processed external video dimensions and cadence.
 */
data class RealtimeExternalVideoFormat(
  /**
   * The processed width, in pixels.
   */
  val width: Int,

  /**
   * The processed height, in pixels.
   */
  val height: Int,

  /**
   * The requested frame rate, in frames per second.
   */
  val fps: Int,
)

/**
 * A receiver for app-owned video and PCM audio. Resolve the handle supplied to the TypeScript
 * source's start callback. Submit on a capture queue; copying finishes before methods return.
 * The app owns permissions, capture resources, pacing, and input buffer release.
 * @constructor Registers a receiver under exclusive RTC ownership.
 * @param handle The expiring attachment identity.
 * @param sourceWidth The upright source width, in pixels.
 * @param sourceHeight The upright source height, in pixels.
 * @param videoFormat The model-constrained processed dimensions and cadence.
 * @param hasAudio Whether to accept external PCM without microphone capture or local playback.
 * @param engine The leased RTC transport.
 * @param failure The first unrecoverable source failure notification.
 */
class RealtimeExternalFrameSink internal constructor(
  /**
   * The expiring attachment identity.
   */
  private val handle: String,

  /**
   * The upright source width, in pixels.
   */
  private val sourceWidth: Int,

  /**
   * The upright source height, in pixels.
   */
  private val sourceHeight: Int,

  /**
   * The processed preview and quality baseline format.
   */
  val videoFormat: RealtimeExternalVideoFormat,
  hasAudio: Boolean,

  /**
   * The exclusively leased native RTC transport.
   */
  private val engine: RtcEngine,

  /**
   * The first unrecoverable native source failure notification.
   */
  private val failure: () -> Unit,
) {

  /**
   * The live attachments, removed before engine release.
   */
  companion object {

    /**
     * The registry indexed by opaque source attachment handles.
     */
    private val registry = ConcurrentHashMap<String, RealtimeExternalFrameSink>()

    /**
     * Finds an active receiver without extending its attachment lifetime.
     * @param nativeHandle The handle from the JavaScript source callback.
     * @return The active receiver, or null after release or failure.
     */
    @JvmStatic
    fun find(
      nativeHandle: String,
    ): RealtimeExternalFrameSink? =
      registry[nativeHandle]?.takeIf { it.isRequestingFrames }
  }

  /**
   * Serializes copying, packetization, and invalidation before engine destruction.
   */
  private val gate = Any()

  /**
   * Whether the receiver accepts further source frames.
   */
  @Volatile private var active = true

  /**
   * Whether native resources have already been invalidated.
   */
  private var invalidated = false

  /**
   * Whether the room currently publishes external audio.
   */
  private var published = false

  /**
   * The last accepted video timestamp, in microseconds.
   */
  private var lastVideoUs = -1L

  /**
   * The serialized source PCM conversion and packetization state.
   */
  private val audio = if (hasAudio) XmaxExternalAudioFrameConverter() else null

  /**
   * The external audio track identity, or null for video-only attachments.
   */
  internal val audioTrackID: Int? = if (hasAudio) {
    val id = engine.createCustomAudioTrack(
      Constants.AudioTrackType.AUDIO_TRACK_DIRECT,
      AudioTrackConfig().apply { enableLocalPlayback = false }
    )
    require(id >= 0) { "Unable to create external audio track" }
    id
  } else null

  init {
    require(sourceWidth >= 2 && sourceHeight >= 2)
    require(videoFormat.width > 0 && videoFormat.height > 0 && videoFormat.fps > 0)
    registry[handle] = this
  }

  /**
   * Whether native video and optional audio can still be submitted, including disconnected preview.
   */
  val isRequestingFrames: Boolean get() = active

  /**
   * Copies a YUV_420_888 image, applies its declared rotation, and resizes for preview and RTC.
   * Odd trailing crop pixels are excluded without modifying the source image.
   * The caller retains the image and may close it after this method returns. Invalid or
   * nonincreasing timestamps are ignored. Pixel conversion and transport remain native.
   * @param image The image with an even-aligned crop origin and Y/U/V planes. The even-trimmed,
   * rotated crop dimensions must match the declared source dimensions.
   * @param timestampUs The nonnegative, strictly increasing shared monotonic timestamp, in microseconds.
   * @param rotation The clockwise pixel rotation, in degrees: 0, 90, 180, or 270.
   */
  @JvmOverloads
  fun pushVideo(
    image: Image,
    timestampUs: Long,
    rotation: Int = 0,
  ) = synchronized(gate) {
    if (!active || timestampUs < 0 || timestampUs > Long.MAX_VALUE / 1000 || timestampUs <= lastVideoUs) return@synchronized
    try {
      require(image.format == android.graphics.ImageFormat.YUV_420_888 && rotation in listOf(0, 90, 180, 270))
      val crop = image.cropRect
      crop.right -= crop.width() % 2
      crop.bottom -= crop.height() % 2
      val width = if (rotation % 180 == 0) crop.width() else crop.height()
      val height = if (rotation % 180 == 0) crop.height() else crop.width()
      require(width == sourceWidth && height == sourceHeight && crop.left % 2 == 0 && crop.top % 2 == 0)
      val input = JavaI420Buffer.allocate(crop.width(), crop.height())
      try {
        for (plane in 0..2) {
          val src = image.planes[plane]
          val dst = when (plane) { 0 -> input.dataY; 1 -> input.dataU; else -> input.dataV }
          val stride = when (plane) { 0 -> input.strideY; 1 -> input.strideU; else -> input.strideV }
          val columns = if (plane == 0) crop.width() else (crop.width() + 1) / 2
          val rows = if (plane == 0) crop.height() else (crop.height() + 1) / 2
          val bytes = src.buffer.duplicate()
          val divisor = if (plane == 0) 1 else 2
          val origin = bytes.position() + crop.top / divisor * src.rowStride + crop.left / divisor * src.pixelStride
          if (src.pixelStride == 1) {
            bytes.position(origin)
            YuvHelper.copyPlane(
              bytes.slice(),
              src.rowStride,
              dst,
              stride,
              columns,
              rows
            )
          } else {
            for (row in 0 until rows) for (column in 0 until columns)
              dst.put(row * stride + column, bytes.get(origin + row * src.rowStride + column * src.pixelStride))
          }
        }
        submit(
          input,
          rotation,
          timestampUs
        )
      } finally { input.release() }
    } catch (error: Exception) {
      fail()
    } catch (error: OutOfMemoryError) {
      fail()
    }
  }

  /**
   * Copies upright RGBA pixels and resizes them for native preview and RTC.
   * @param pixels The direct source-sized RGBA8888 buffer, with mirroring already applied.
   * @param stride The input bytes per row, at least sourceWidth times four.
   * @param timestampUs The strictly increasing shared monotonic timestamp, in microseconds.
   */
  fun pushVideo(
    pixels: ByteBuffer,
    stride: Int,
    timestampUs: Long,
  ) = synchronized(gate) {
    if (!active || timestampUs < 0 || timestampUs > Long.MAX_VALUE / 1000 || timestampUs <= lastVideoUs) return@synchronized
    try {
      require(pixels.isDirect && stride.toLong() >= sourceWidth.toLong() * 4 && pixels.remaining().toLong() >= stride.toLong() * (sourceHeight - 1) + sourceWidth.toLong() * 4)
      val input = JavaI420Buffer.allocate(sourceWidth, sourceHeight)
      try {
        require(YuvHelper.nativeRgbaToI420(
          pixels.slice(),
          stride,
          input.dataY,
          input.strideY,
          input.dataU,
          input.strideU,
          input.dataV,
          input.strideV,
          sourceWidth,
          sourceHeight
        ) == 0)
        submit(
          input,
          0,
          timestampUs
        )
      } finally { input.release() }
    } catch (error: Exception) {
      fail()
    } catch (error: OutOfMemoryError) {
      fail()
    }
  }

  /**
   * Copies interleaved PCM16 and converts it to 48 kHz mono 10 ms packets without local playback.
   * The format must remain stable. Invalid or overlapping timestamps are ignored. Gaps begin a new
   * segment; audio received while unpublished is discarded instead of queued for reconnection.
   * @param samples The little-endian interleaved signed PCM16 samples.
   * @param sampleRate The source sample rate, from 8000 through 192000 Hz.
   * @param channels The source channel count, from one through eight.
   * @param timestampUs The first sample's timestamp on the video timeline, in microseconds.
   */
  fun pushAudio(
    samples: ByteBuffer,
    sampleRate: Int,
    channels: Int,
    timestampUs: Long,
  ) = synchronized(gate) {
    if (!active || audioTrackID == null || audio == null) return@synchronized
    try {
      audio.append(
        samples,
        sampleRate,
        channels,
        timestampUs
      ) { data, timeUs ->
        if (published) engine.pushExternalAudioFrame(
          data,
          timeUs / 1000,
          48000,
          1,
          Constants.BytesPerSample.TWO_BYTES_PER_SAMPLE,
          audioTrackID
        )
      }
      if (!published) audio.discardPendingAudio()
    } catch (error: Exception) {
      fail()
    }
  }

  /**
   * Reports the first unrecoverable source failure and rejects later delivery.
   * @param error The capture or decoding failure; its contents are not logged by XmaxSDK.
   */
  fun reportError(
    error: Throwable,
  ) = synchronized(gate) { if (active) fail() }

  /**
   * Changes external audio publication and discards partial audio from the previous room.
   * @param value Whether the joined room publishes external PCM.
   */
  internal fun setPublished(
    value: Boolean,
  ) = synchronized(gate) {
    published = value
    audio?.discardPendingAudio()
  }

  /**
   * Invalidates queued handles and waits for frame copying before engine destruction.
   */
  internal fun invalidate() = synchronized(gate) {
    if (invalidated) return@synchronized
    invalidated = true
    active = false
    registry.remove(
      handle,
      this
    )
    audio?.discardPendingAudio()
    audioTrackID?.let { engine.destroyCustomAudioTrack(it) }
  }

  /**
   * Rotates and scales an owned I420 copy before submitting a retained native video frame.
   * @param input The copied source pixels.
   * @param rotation The clockwise pixel rotation, in degrees.
   * @param timestampUs The frame timestamp, in microseconds.
   */
  private fun submit(
    input: JavaI420Buffer,
    rotation: Int,
    timestampUs: Long,
  ) {
    val upright = if (rotation == 0) {
      input.retain()
      input
    } else {
      val width = if (rotation % 180 == 0) input.width else input.height
      val height = if (rotation % 180 == 0) input.height else input.width
      val rotated = JavaI420Buffer.allocate(width, height)
      try {
        YuvHelper.I420Rotate(
          input.dataY,
          input.strideY,
          input.dataU,
          input.strideU,
          input.dataV,
          input.strideV,
          rotated.dataY,
          rotated.strideY,
          rotated.dataU,
          rotated.strideU,
          rotated.dataV,
          rotated.strideV,
          input.width,
          input.height,
          rotation
        )
        rotated
      } catch (error: Throwable) {
        rotated.release()
        throw error
      }
    }
    try {
      val scaled = requireNotNull(upright.cropAndScale(
        0,
        0,
        upright.width,
        upright.height,
        videoFormat.width,
        videoFormat.height
      ))
      val frame = VideoFrame(
        scaled,
        0,
        timestampUs * 1000
      )
      try {
        lastVideoUs = timestampUs
        engine.pushExternalVideoFrame(frame)
      } finally { frame.release() }
    } finally { upright.release() }
  }

  /**
   * Notifies lifecycle coordination once without writing capture data or source paths to logs.
   */
  private fun fail() {
    if (!active) return
    active = false
    failure()
  }
}
