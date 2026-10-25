//
//  XmaxExternalAudioFrameConverter.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.floor

/**
 * Converts a serialized PCM16 stream into owned 48 kHz mono 10 ms packets.
 * Format and timestamp validation remain active across publication changes.
 */
internal class XmaxExternalAudioFrameConverter {

  /**
   * The sample rate and channel count fixed by the first accepted source buffer.
   */
  private var format: Pair<Int, Int>? = null

  /**
   * The exclusive timestamp of the previous input buffer, in microseconds.
   */
  private var nextInputUs = -1.0

  /**
   * Whether output starts a new contiguous segment at the next accepted buffer.
   */
  private var needsSegment = true

  /**
   * The segment's first output sample timestamp, in microseconds.
   */
  private var anchorUs = 0L

  /**
   * The next fractional source position used for streaming interpolation.
   */
  private var position = 0.0

  /**
   * The last source sample, retained for interpolation across buffer boundaries.
   */
  private var previousSample = 0.0

  /**
   * The pending PCM16 packet, holding at most 480 samples.
   */
  private val packet = ByteBuffer.allocate(960).order(ByteOrder.LITTLE_ENDIAN)

  /**
   * The number of output samples already delivered in the current segment.
   */
  private var emitted = 0L

  /**
   * Clears pending output while preserving the source format and timestamp validation.
   */
  fun discardPendingAudio() {
    packet.clear()
    needsSegment = true
  }

  /**
   * Resamples PCM16 and emits independent mono packets. Invalid or overlapping timestamps are
   * ignored; gaps start a new segment without inserting silence.
   *
   * @param samples The contiguous interleaved little-endian PCM16 samples.
   * @param sampleRate The source rate, from 8000 through 192000 Hz.
   * @param channels The source channel count, from one through eight.
   * @param timestampUs The first source sample's shared monotonic timestamp, in microseconds.
   * @param receive The synchronous receiver of owned packets and their timestamps.
   */
  fun append(
    samples: ByteBuffer,
    sampleRate: Int,
    channels: Int,
    timestampUs: Long,
    receive: (ByteArray, Long) -> Unit,
  ) {
    if (timestampUs < 0 || timestampUs > Long.MAX_VALUE / 1000) return
    require(sampleRate in 8000..192000 && channels in 1..8)
    require(samples.remaining() % (channels * 2) == 0)
    val requested = sampleRate to channels
    require(format == null || format == requested) { "PCM format cannot change during an attachment" }
    format = requested
    val frames = samples.remaining() / (channels * 2)
    if (frames == 0) return
    val tolerance = 500000.0 / sampleRate
    if (nextInputUs >= 0 && timestampUs < nextInputUs - tolerance) return
    if (needsSegment || nextInputUs < 0 || abs(timestampUs - nextInputUs) > tolerance) {
      packet.clear()
      position = 0.0
      emitted = 0
      anchorUs = timestampUs
      needsSegment = false
    }
    val input = samples.slice().order(ByteOrder.LITTLE_ENDIAN)
    /**
     * Reads one mono source sample while preserving interpolation across buffer boundaries.
     * @param index The frame position in the current buffer, or minus one for the preceding sample.
     * @return The averaged PCM16 sample amplitude.
     */
    fun sample(
      index: Int,
    ): Double {
      if (index < 0) return previousSample
      var sum = 0.0
      for (channel in 0 until channels) sum += input.getShort((index * channels + channel) * 2).toDouble()
      return sum / channels
    }
    while (position < frames) {
      val left = floor(position).toInt()
      val fraction = position - left
      if (fraction > 0 && left + 1 >= frames) break
      val value = if (fraction == 0.0) sample(left) else sample(left) * (1 - fraction) + sample(left + 1) * fraction
      packet.putShort(value.toInt().coerceIn(-32768, 32767).toShort())
      if (!packet.hasRemaining()) {
        receive(
          packet.array().copyOf(),
          anchorUs + emitted * 1000000 / 48000
        )
        emitted += 480
        packet.clear()
      }
      position += sampleRate / 48000.0
    }
    position -= frames
    previousSample = sample(frames - 1)
    nextInputUs = timestampUs + frames * 1000000.0 / sampleRate
  }
}
