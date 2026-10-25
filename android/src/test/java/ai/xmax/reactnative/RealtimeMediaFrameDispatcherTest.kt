package ai.xmax.reactnative

import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class RealtimeMediaFrameDispatcherTest {
  private class Queue : AbstractExecutorService() {
    val tasks = ArrayDeque<Runnable>()
    private var stopped = false
    override fun execute(task: Runnable) { tasks.add(task) }
    override fun shutdown() { stopped = true }
    override fun shutdownNow(): MutableList<Runnable> { stopped = true; return mutableListOf() }
    override fun isShutdown() = stopped
    override fun isTerminated() = stopped && tasks.isEmpty()
    override fun awaitTermination(timeout: Long, unit: TimeUnit) = isTerminated
    fun drain() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
  }
  private fun pcm(time: Long = 1_000_000) = RealtimeAudioFrame(
    ByteBuffer.allocate(960).asReadOnlyBuffer(), 48000, 1, 480, time
  )

  @Test fun batchedAudioKeepsSampleTimeAndQueueLossDoesNotCompressIt() {
    val queue = Queue()
    val frames = mutableListOf<RealtimeMediaFrame>()
    val consumer = RealtimeMediaFrameConsumer { frames.add(it) }
    val output = RealtimeMediaFrameDispatcher(1, 1024, queue)
    output.configure(consumer, "stream")
    output.audio(pcm(), "stream")
    output.audio(pcm(), "stream")
    queue.drain()
    output.audio(pcm(), "stream")
    queue.drain()
    assertEquals(listOf(1_000_000L, 1_020_000L), frames.map { it.presentationTimeStamp })
    assertTrue(frames.all { it.isDiscontinuous })
    output.audio(pcm(2_000_000), "stream")
    queue.drain()
    assertEquals(2_000_000L, frames.last().presentationTimeStamp)
    assertTrue(frames.last().isDiscontinuous)
    output.close(); consumer.close()
  }

  @Test fun byteLimitsRejectOversizedPacketsAndRemovedOrRetiredListenersReceiveNothing() {
    val queue = Queue()
    val frames = mutableListOf<RealtimeMediaFrame>()
    val consumer = RealtimeMediaFrameConsumer { frames.add(it) }
    val output = RealtimeMediaFrameDispatcher(256, 512, queue)
    output.configure(consumer, "old")
    output.audio(pcm(), "old")
    assertTrue(queue.tasks.isEmpty())
    val small = RealtimeAudioFrame(ByteBuffer.allocate(480), 48000, 1, 240, 1_010_000)
    output.audio(small, "old")
    output.configure(null, null)
    queue.drain()
    assertTrue(frames.isEmpty())
    output.configure(consumer, "new")
    output.audio(small, "old")
    output.audio(small, "new")
    queue.drain()
    assertEquals(1, frames.size)
    assertEquals("new", frames[0].streamID)
    assertTrue(frames[0].isDiscontinuous)
    output.close(); consumer.close()
  }

  @Test fun rejectedAudioReanchorsAtNativeTimeAndInvalidatedConsumersStopDelivery() {
    val queue = Queue()
    val frames = mutableListOf<RealtimeMediaFrame>()
    val consumer = RealtimeMediaFrameConsumer { frames.add(it) }
    val output = RealtimeMediaFrameDispatcher(queue = queue)
    output.configure(consumer, "stream")
    output.audio(pcm(), "stream"); queue.drain()
    output.discard(true, "stream")
    output.audio(pcm(1_020_000), "stream"); queue.drain()
    assertEquals(1_020_000L, frames.last().presentationTimeStamp)
    assertTrue(frames.last().isDiscontinuous)
    assertSame(consumer, RealtimeMediaFrameConsumer.find(consumer.nativeHandle))
    consumer.close()
    assertNull(RealtimeMediaFrameConsumer.find(consumer.nativeHandle))
    output.audio(pcm(1_030_000), "stream"); queue.drain()
    assertEquals(2, frames.size)
    output.close()
  }

  @Test fun nativeAudioFiltersTheResultUserAndCopiesBorrowedBuffers() {
    val received = java.util.concurrent.CountDownLatch(1)
    var packet: RealtimeMediaFrame? = null
    val consumer = RealtimeMediaFrameConsumer { packet = it; received.countDown() }
    val observer = XmaxRemoteFrameObserver { _, _, _ -> }
    observer.setOutput(consumer, "room", 42, "stream")
    val input = ByteBuffer.allocate(960)
    input.put(0, 7)
    observer.audio("wrong", 42, 480, 2, 1, 48000, input, 1000)
    observer.audio("room", 1, 480, 2, 1, 48000, input, 1000)
    assertNull(packet)
    observer.audio("room", 42, 480, 2, 1, 48000, input, 1000)
    input.put(0, 99)
    assertTrue(received.await(2, TimeUnit.SECONDS))
    val audio = packet!!.content as RealtimeAudioFrame
    assertEquals(7.toByte(), audio.data.get(0))
    assertTrue(audio.data.isReadOnly)
    observer.close(); consumer.close()
  }

  @Test fun nativeVideoCopiesPaddedPlanesAndKeepsRotationAndRenderingClock() {
    assertNativeVideoClock(1000, 5_000_000_000L, 1_000_000L)
  }

  @Test fun nativeVideoWithZeroRenderStartTimeUsesSharedRenderingClock() {
    assertNativeVideoClock(0, 4_567_890_123L, 1_792_000_000_567_890L)
  }

  @Test fun nativeVideoWithMissingRenderStartTimeAndInvalidPresentationTimeIsDiscarded() {
    assertNativeVideoClock(0, 0, null)
  }

  private fun assertNativeVideoClock(renderTimeMs: Long, timestampNs: Long, expectedPTS: Long?) {
    val received = java.util.concurrent.CountDownLatch(1)
    var packet: RealtimeVideoFrame? = null
    val consumer = RealtimeMediaFrameConsumer { packet = it.content as RealtimeVideoFrame; received.countDown() }
    val observer = XmaxRemoteFrameObserver(RemoteVideoTimeline({ 1_792_000_000_000L }, { 4_000_000_000L })) { _, _, _ -> }
    observer.setOutput(consumer, "room", 42, "stream")
    val y = ByteBuffer.wrap(byteArrayOf(1, 2, 0, 0, 3, 4, 0, 0))
    var released = 0
    val input = object : io.agora.base.VideoFrame.I420Buffer {
      override fun getWidth() = 2
      override fun getHeight() = 2
      override fun getDataY() = y
      override fun getDataU() = ByteBuffer.wrap(byteArrayOf(5, 0))
      override fun getDataV() = ByteBuffer.wrap(byteArrayOf(6, 0))
      override fun getStrideY() = 4
      override fun getStrideU() = 2
      override fun getStrideV() = 2
      override fun toI420() = this
      override fun toI010(): io.agora.base.VideoFrame.I010Buffer = error("Unused")
      override fun retain() {}
      override fun release() { released++ }
      override fun cropAndScale(a: Int, b: Int, c: Int, d: Int, e: Int, f: Int): io.agora.base.VideoFrame.Buffer = error("Unused")
      override fun mirror(a: Int): io.agora.base.VideoFrame.Buffer = error("Unused")
      override fun rotate(a: Int): io.agora.base.VideoFrame.Buffer = error("Unused")
      override fun transform(a: Int, b: Int, c: Int, d: Int, e: Int, f: Int, g: Int): io.agora.base.VideoFrame.Buffer = error("Unused")
    }
    val native = io.agora.base.VideoFrame(input, 90, timestampNs, null, null, 0L, 1f, 0, renderTimeMs)
    observer.onRenderVideoFrame("room", 42, native)
    y.put(0, 99)
    if (expectedPTS == null) {
      assertFalse(received.await(100, TimeUnit.MILLISECONDS))
      assertEquals(0, released)
      observer.close(); consumer.close()
      return
    }
    assertTrue(received.await(2, TimeUnit.SECONDS))
    val video = packet!!
    val pixels = ByteArray(4); video.y.duplicate().get(pixels)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), pixels)
    assertEquals(5.toByte(), video.u.get(0))
    assertEquals(6.toByte(), video.v.get(0))
    assertEquals(90, video.rotation)
    assertEquals(expectedPTS, video.presentationTimeStamp)
    assertEquals(1, released)
    observer.close(); consumer.close()
  }

}
