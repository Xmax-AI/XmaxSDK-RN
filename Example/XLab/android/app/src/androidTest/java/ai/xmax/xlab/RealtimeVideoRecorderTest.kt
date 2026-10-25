package ai.xmax.xlab

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import org.junit.Test
import org.junit.Assert.*
import androidx.test.platform.app.InstrumentationRegistry
import ai.xmax.reactnative.RealtimeAudioFrame
import ai.xmax.reactnative.RealtimeMediaContent
import ai.xmax.reactnative.RealtimeMediaFrame
import ai.xmax.reactnative.RealtimeVideoFrame
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.sin

/** Exercises the real device encoders and MP4 album output with deterministic native frames. */
@Suppress("DEPRECATION")
class RealtimeVideoRecorderTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

  @Test
  fun testAudioVideoRecordingPreservesOffsetsAndRotation() {
    val recorder = RealtimeVideoRecorder(context)
    start(recorder)
    val base = 5_000_000L
    for (index in 0 until 100) {
      if (index !in 40..49) recorder.append(packet(audio(base + index * 10_000, index * 480)))
      if (index >= 12 && index % 3 == 0)
        recorder.append(packet(video(base + index * 10_000, rotation = 90)))
    }
    val uri = stop(recorder)
    try {
      val metadata = MediaMetadataRetriever()
      try {
        metadata.setDataSource(context, uri)
        assertEquals("90", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION))
        assertEquals("64", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))
        assertEquals("96", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT))
        val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
        assertTrue("Recorded duration: $duration", duration in 950..1200)
        val bitmap = checkNotNull(metadata.getFrameAtTime(500_000))
        try {
          var low = 255
          var high = 0
          for (y in 0 until bitmap.height step 4) for (x in 0 until bitmap.width step 4) {
            val red = (bitmap.getPixel(x, y) shr 16) and 255
            low = minOf(low, red)
            high = maxOf(high, red)
          }
          assertTrue("The recorded test pattern must remain visible", high - low > 40)
        } finally { bitmap.recycle() }
      } finally { metadata.release() }
      val reader = MediaExtractor()
      try {
        reader.setDataSource(context, uri, null)
        assertEquals(2, reader.trackCount)
        val video = (0 until reader.trackCount).first { reader.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
        reader.selectTrack(video)
        assertTrue("Video must retain its 120ms offset: ${reader.sampleTime}", reader.sampleTime in 100_000..145_000)
        reader.unselectTrack(video)
        val audio = 1 - video
        reader.selectTrack(audio)
        val format = reader.getTrackFormat(audio)
        assertEquals("audio/mp4a-latm", format.getString(MediaFormat.KEY_MIME))
        assertEquals(48_000, format.getInteger(MediaFormat.KEY_SAMPLE_RATE))
        assertEquals(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
      } finally { reader.release() }
      verifyAudio(uri)
    } finally {
      context.contentResolver.delete(uri, null, null)
      recorder.close()
    }
  }

  @Test
  fun testVideoOnlyRecordingAndRepeatedUse() {
    val recorder = RealtimeVideoRecorder(context)
    try {
      repeat(2) {
        start(recorder)
        repeat(15) { index -> recorder.append(packet(video(9_000_000L + index * 33_333L))) }
        val uri = stop(recorder)
        try {
          val reader = MediaExtractor()
          try {
            reader.setDataSource(context, uri, null)
            assertEquals(1, reader.trackCount)
            assertTrue(reader.getTrackFormat(0).getString(MediaFormat.KEY_MIME)!!.startsWith("video/"))
          } finally { reader.release() }
        } finally { context.contentResolver.delete(uri, null, null) }
      }
    } finally { recorder.close() }
  }

  @Test
  fun testPortraitModelResolutionAtRealtimeCadence() {
    val recorder = RealtimeVideoRecorder(context)
    start(recorder)
    try {
      repeat(20) { index ->
        recorder.append(packet(video(20_000_000L + index * 33_333L, width = 1024, height = 1920)))
        Thread.sleep(33)
      }
      val uri = stop(recorder)
      try {
        val metadata = MediaMetadataRetriever()
        try {
          metadata.setDataSource(context, uri)
          assertEquals("1024", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))
          assertEquals("1920", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT))
          val frame = checkNotNull(metadata.getFrameAtTime(300_000))
          frame.recycle()
        } finally { metadata.release() }
      } finally { context.contentResolver.delete(uri, null, null) }
    } finally { recorder.close() }
  }

  @Test
  fun testEmptyAndChangedStreamRecordingsFailWithoutPublishing() {
    val recorder = RealtimeVideoRecorder(context)
    try {
      start(recorder)
      assertEquals("record.noFrames", stopError(recorder))
      start(recorder)
      recorder.append(packet(video(1_000_000)))
      recorder.append(packet(video(1_033_333), stream = "replacement"))
      assertEquals("record.timelineChanged", stopError(recorder))
    } finally { recorder.close() }
  }

  /** Decodes the saved AAC and checks audible PCM plus silence preserved across an input gap. */
  private fun verifyAudio(uri: Uri) {
    val reader = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      reader.setDataSource(context, uri, null)
      val index = (0 until reader.trackCount).first { reader.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("audio/") }
      reader.selectTrack(index)
      val format = reader.getTrackFormat(index)
      codec = MediaCodec.createDecoderByType(checkNotNull(format.getString(MediaFormat.KEY_MIME)))
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()
      var inputEnded = false
      var outputEnded = false
      var peak = 0
      var silentSamples = 0
      var samples = 0
      val deadline = System.nanoTime() + 10_000_000_000L
      while (!outputEnded) {
        check(System.nanoTime() < deadline) { "AAC decoding timed out" }
        if (!inputEnded) {
          val input = codec.dequeueInputBuffer(10_000)
          if (input >= 0) {
            val buffer = checkNotNull(codec.getInputBuffer(input))
            val count = reader.readSampleData(buffer, 0)
            if (count < 0) {
              inputEnded = true
              codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            } else {
              codec.queueInputBuffer(input, 0, count, reader.sampleTime, 0)
              reader.advance()
            }
          }
        }
        val output = codec.dequeueOutputBuffer(info, 10_000)
        if (output >= 0) {
          try {
            val pcm = checkNotNull(codec.getOutputBuffer(output)).duplicate().order(ByteOrder.LITTLE_ENDIAN)
            pcm.position(info.offset)
            pcm.limit(info.offset + info.size)
            while (pcm.remaining() >= 2) {
              val amplitude = kotlin.math.abs(pcm.short.toInt())
              peak = maxOf(peak, amplitude)
              if (amplitude < 100) silentSamples++
              samples++
            }
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          } finally { codec.releaseOutputBuffer(output, false) }
        }
      }
      assertTrue("The MP4 must contain audible result PCM", peak > 1000)
      assertTrue("The 100ms PCM gap must remain in the timeline: $samples", samples >= 47_000)
      assertTrue("The PCM gap must be encoded as silence: $silentSamples", silentSamples > 3500)
    } finally {
      runCatching { codec?.stop() }
      codec?.release()
      reader.release()
    }
  }

  private fun start(recorder: RealtimeVideoRecorder) {
    val done = CountDownLatch(1)
    var failure: String? = null
    recorder.start { error -> failure = error; done.countDown() }
    assertTrue(done.await(15, TimeUnit.SECONDS))
    assertNull(failure)
  }

  private fun stop(recorder: RealtimeVideoRecorder): Uri {
    val done = CountDownLatch(1)
    var output: String? = null
    var failure: String? = null
    recorder.stopAndSave { uri, error -> output = uri; failure = error; done.countDown() }
    assertTrue("Encoder finalization timed out", done.await(30, TimeUnit.SECONDS))
    assertNull(failure)
    return Uri.parse(checkNotNull(output))
  }

  private fun stopError(recorder: RealtimeVideoRecorder): String? {
    val done = CountDownLatch(1)
    var failure: String? = null
    recorder.stopAndSave { _, error -> failure = error; done.countDown() }
    assertTrue(done.await(30, TimeUnit.SECONDS))
    return failure
  }

  // SDK-owned packet constructors are internal to Kotlin callers; reflection supplies deterministic test data.
  private fun packet(content: RealtimeMediaContent, stream: String = "recording-test"): RealtimeMediaFrame =
    RealtimeMediaFrame::class.java.getDeclaredConstructor(String::class.java, Boolean::class.javaPrimitiveType,
      RealtimeMediaContent::class.java).newInstance(stream, false, content)

  private fun video(pts: Long, rotation: Int = 0, width: Int = 64, height: Int = 96): RealtimeVideoFrame =
    RealtimeVideoFrame::class.java.getDeclaredConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
      ByteBuffer::class.java, ByteBuffer::class.java, ByteBuffer::class.java, Int::class.javaPrimitiveType,
      Long::class.javaPrimitiveType).newInstance(width, height,
      ByteBuffer.wrap(ByteArray(width * height) { if (it % width < width / 2) 70 else 180.toByte() }),
      ByteBuffer.wrap(ByteArray(width / 2 * (height / 2)) { 90.toByte() }),
      ByteBuffer.wrap(ByteArray(width / 2 * (height / 2)) { 160.toByte() }), rotation, pts)

  private fun audio(pts: Long, offset: Int): RealtimeAudioFrame {
    val data = ByteBuffer.allocate(480 * 2).order(ByteOrder.LITTLE_ENDIAN)
    repeat(480) { index -> data.putShort((sin((offset + index) * 2 * Math.PI * 440 / 48_000) * 5000).toInt().toShort()) }
    data.flip()
    return RealtimeAudioFrame::class.java.getDeclaredConstructor(ByteBuffer::class.java, Int::class.javaPrimitiveType,
      Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Long::class.javaPrimitiveType)
      .newInstance(data, 48_000, 1, 480, pts)
  }
}
