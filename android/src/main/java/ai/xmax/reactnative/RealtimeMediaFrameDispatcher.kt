//
//  RealtimeMediaFrameDispatcher.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Serializes bounded native output and rejects queued packets from retired bindings or listeners.
 */
internal class RealtimeMediaFrameDispatcher(

  /**
   * The maximum retained packets, including a running callback.
   */
  private val maximumPendingFrames: Int = 256,

  /**
   * The maximum retained media bytes, including a running callback.
   */
  private val maximumPendingBytes: Int = 32 * 1024 * 1024,

  /**
   * The dedicated serial callback queue.
   */
  private val queue: ExecutorService = Executors.newSingleThreadExecutor()
) {

  /**
   * Protects binding, timeline, listener, and queue admission state.
   */
  private val lock = Any()

  /**
   * The active native output receiver.
   */
  private var consumer: RealtimeMediaFrameConsumer? = null

  /**
   * The current result binding identity.
   */
  private var streamID: String? = null

  /**
   * The revision rejecting queued callbacks after replacement or cleanup.
   */
  private var version = 0L

  /**
   * The retained packet count across all revisions.
   */
  private var pendingFrames = 0

  /**
   * The retained media byte count across all revisions.
   */
  private var pendingBytes = 0

  /**
   * The first native audio timestamp in the current continuous run, in microseconds.
   */
  private var audioAnchor: Long? = null

  /**
   * The audio samples accepted since the current anchor.
   */
  private var audioSamples = 0L

  /**
   * The most recently accepted PCM format.
   */
  private var audioFormat: Pair<Int, Int>? = null

  /**
   * The most recent video format and rotation.
   */
  private var videoFormat: List<Int>? = null

  /**
   * The most recent video rendering timestamp, in microseconds.
   */
  private var videoPTS: Long? = null

  /**
   * Whether the next admitted audio packet follows a discontinuity.
   */
  private var audioDiscontinuous = true

  /**
   * Whether the next admitted video packet follows a discontinuity.
   */
  private var videoDiscontinuous = true

  /**
   * Replaces the receiver and stream while invalidating pending callbacks and timeline state.
   *
   * @param consumer The app receiver, or null to disable queued delivery.
   * @param identity The result binding identity, or null after unbinding.
   */
  fun configure(
    consumer: RealtimeMediaFrameConsumer?,
    identity: String?
  ) = synchronized(lock) {
    version++
    this.consumer = consumer
    streamID = identity
    audioAnchor = null
    audioSamples = 0
    audioFormat = null
    videoFormat = null
    videoPTS = null
    audioDiscontinuous = true
    videoDiscontinuous = true
  }

  /**
   * Normalizes copied PCM by sample count and marks gaps without compressing the timeline.
   *
   * @param frame The copied pre-mix PCM and native rendering timestamp.
   * @param identity The producer binding; retired bindings are ignored.
   */
  fun audio(
    frame: RealtimeAudioFrame,
    identity: String
  ) = synchronized(lock) {
    if (streamID != identity || consumer == null) return@synchronized
    val format = frame.sampleRate to frame.channels
    val next = audioAnchor?.let { it + audioSamples * 1_000_000 / frame.sampleRate }
    if (audioFormat != format || next == null || abs(frame.presentationTimeStamp - next) > 100_000) {
      audioAnchor = frame.presentationTimeStamp
      audioSamples = 0
      audioDiscontinuous = true
    }
    val pts = audioAnchor!! + audioSamples * 1_000_000 / frame.sampleRate
    audioSamples += frame.samplesPerChannel
    audioFormat = format
    audioDiscontinuous = !enqueue(
      RealtimeMediaFrame(
        identity,
        audioDiscontinuous,
        frame.copy(presentationTimeStamp = pts)
      ),
      frame.data.remaining()
    )
  }

  /**
   * Enqueues owned video and marks format changes or a nonincreasing rendering clock.
   *
   * @param frame The owned I420 planes and rendering timestamp.
   * @param identity The producer binding; retired bindings are ignored.
   */
  fun video(
    frame: RealtimeVideoFrame,
    identity: String
  ) = synchronized(lock) {
    if (streamID != identity || consumer == null) return@synchronized
    val format = listOf(
      frame.width,
      frame.height,
      frame.rotation
    )
    val discontinuous = videoDiscontinuous || videoFormat != format || videoPTS?.let { frame.presentationTimeStamp <= it } == true
    videoFormat = format
    videoPTS = frame.presentationTimeStamp
    videoDiscontinuous = !enqueue(
      RealtimeMediaFrame(
        identity,
        discontinuous,
        frame
      ),
      frame.y.remaining() + frame.u.remaining() + frame.v.remaining()
    )
  }

  /**
   * Marks a rejected packet so the next valid packet exposes the lost output.
   *
   * @param audio Whether the rejected packet was PCM rather than video.
   * @param identity The producer binding; retired bindings cannot affect current output.
   */
  fun discard(
    audio: Boolean,
    identity: String
  ) = synchronized(lock) {
    if (streamID != identity) return@synchronized
    if (audio) {
      audioDiscontinuous = true
      audioAnchor = null
      audioSamples = 0
      audioFormat = null
    } else videoDiscontinuous = true
  }

  /**
   * Stops admission and retires queued output before engine destruction.
   */
  fun close() {
    configure(
      null,
      null
    )
    queue.shutdown()
  }

  /**
   * Admits one packet within both limits. Requires lock; user callbacks run outside it.
   *
   * @param frame The owned audio or video event.
   * @param bytes The retained media byte count.
   */
  private fun enqueue(
    frame: RealtimeMediaFrame,
    bytes: Int
  ): Boolean {
    if (pendingFrames >= maximumPendingFrames || bytes > maximumPendingBytes - pendingBytes) return false
    val revision = version
    pendingFrames++
    pendingBytes += bytes
    queue.execute {
      try {
        val callback = synchronized(lock) { if (revision == version && streamID == frame.streamID) consumer else null }
        try { callback?.receive(frame) } catch (_: Exception) { /* Application failures cannot stop RTC observation. */ }
      } finally {
        synchronized(lock) { pendingFrames--; pendingBytes -= bytes }
      }
    }
    return true
  }
}
