//
//  RealtimeMediaFrame.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import java.nio.ByteBuffer

/**
 * An owned remote packet with a receiver rendering timestamp, in microseconds.
 */
sealed interface RealtimeMediaContent {

  /**
   * The presentation time on the receiver rendering clock, in microseconds.
   */
  val presentationTimeStamp: Long

  /**
   * The packet duration in microseconds, or null for video with unknown cadence.
   */
  val duration: Long?
}

/**
 * Owned interleaved signed little-endian PCM16 from the result user, before mixing.
 */
data class RealtimeAudioFrame internal constructor(

  /**
   * The read-only copied PCM bytes, safe to retain after delivery.
   */
  val data: ByteBuffer,

  /**
   * The number of samples per second in each channel.
   */
  val sampleRate: Int,

  /**
   * The number of interleaved channels.
   */
  val channels: Int,

  /**
   * The number of samples in each channel of this packet.
   */
  val samplesPerChannel: Int,

  /**
   * The sample-count-based presentation time, in microseconds.
   */
  override val presentationTimeStamp: Long
) : RealtimeMediaContent {

  /**
   * The audio duration derived from its sample count, in microseconds.
   */
  override val duration: Long get() = samplesPerChannel.toLong() * 1_000_000 / sampleRate
}

/**
 * Owned I420 video. Apply rotation clockwise when displaying or encoding the copied planes.
 */
data class RealtimeVideoFrame internal constructor(

  /**
   * The unrotated width, in pixels.
   */
  val width: Int,

  /**
   * The unrotated height, in pixels.
   */
  val height: Int,

  /**
   * The tightly packed, read-only luma plane with width-byte rows.
   */
  val y: ByteBuffer,

  /**
   * The tightly packed, read-only U plane with ceil(width / 2)-byte rows.
   */
  val u: ByteBuffer,

  /**
   * The tightly packed, read-only V plane with ceil(width / 2)-byte rows.
   */
  val v: ByteBuffer,

  /**
   * The clockwise display rotation: 0, 90, 180, or 270 degrees.
   */
  val rotation: Int,

  /**
   * The receiver rendering time, in microseconds.
   */
  override val presentationTimeStamp: Long
) : RealtimeMediaContent {

  /**
   * Video duration is unknown; preserve presentation timestamps when scheduling frames.
   */
  override val duration: Long? get() = null
}

/**
 * One remote audio or video packet. Events follow producer delivery order, not cross-track PTS
 * order. Schedule both tracks by their timestamps using one shared origin.
 */
data class RealtimeMediaFrame internal constructor(

  /**
   * The opaque result binding identity shared by audio and video; changes after reconnection.
   */
  val streamID: String,

  /**
   * Whether this track starts a run, changes format or clock, or follows discarded output.
   */
  val isDiscontinuous: Boolean,

  /**
   * The owned remote PCM or video payload.
   */
  val content: RealtimeMediaContent
) {

  /**
   * The packet's receiver rendering timestamp, in microseconds.
   */
  val presentationTimeStamp: Long get() = content.presentationTimeStamp

  /**
   * The audio duration, or null for video, in microseconds.
   */
  val duration: Long? get() = content.duration
}

/**
 * A serialized background handler for owned remote audio and video packets.
 */
typealias RealtimeMediaFrameListener = (RealtimeMediaFrame) -> Unit
