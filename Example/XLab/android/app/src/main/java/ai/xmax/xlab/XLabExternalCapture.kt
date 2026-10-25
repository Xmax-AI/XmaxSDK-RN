package ai.xmax.xlab

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import ai.xmax.reactnative.RealtimeExternalFrameSink
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.LockSupport

/** App-owned file decoding; the SDK sees native frames rather than a file player. */
private class XLabFileVideoSource(val context: Context, val uri: Uri, val fps: Int) {
  val width: Int
  val height: Int
  val durationUs: Long
  val rotation: Int
  val hasAudio: Boolean
  private val running = AtomicBoolean(false)
  private val workers = mutableListOf<Thread>()

  init {
    require(fps in 1..120)
    val metadata = MediaMetadataRetriever()
    try {
      metadata.setDataSource(context, uri)
      rotation = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val w = requireNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull())
      val h = requireNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull())
      width = (if (rotation % 180 == 0) w else h) / 2 * 2
      height = (if (rotation % 180 == 0) h else w) / 2 * 2
      durationUs = (metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0) * 1000
      hasAudio = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
      require(width >= 2 && height >= 2 && durationUs > 0)
    } finally { metadata.release() }
  }

  /** Runs independent decoders on one host timeline, including across file loops. */
  fun start(sink: RealtimeExternalFrameSink) {
    check(running.compareAndSet(false, true))
    val anchorUs = SystemClock.elapsedRealtimeNanos() / 1000 + 20000
    for (audio in if (hasAudio) listOf(false, true) else listOf(false)) {
      val thread = Thread({
        try {
          var loop = 0L
          while (running.get() && sink.isRequestingFrames) {
            decode(sink, audio, anchorUs + loop * durationUs)
            loop++
          }
        } catch (error: Exception) {
          if (running.getAndSet(false) && sink.isRequestingFrames) sink.reportError(error)
        }
      }, if (audio) "XLab-external-audio" else "XLab-external-video")
      synchronized(workers) { workers.add(thread) }
      thread.start()
    }
  }

  /** Cancels pacing waits and waits for all readers and codecs to release their buffers. */
  fun stop() {
    running.set(false)
    val previous = synchronized(workers) { workers.toList().also { workers.clear() } }
    previous.forEach { it.interrupt() }
    previous.forEach { if (it !== Thread.currentThread()) it.join() }
  }

  /** Decodes one cycle without queueing frames beyond their presentation time. */
  private fun decode(sink: RealtimeExternalFrameSink, audio: Boolean, anchorUs: Long) {
    val reader = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      reader.setDataSource(context, uri, null)
      val index = (0 until reader.trackCount).firstOrNull {
        reader.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(if (audio) "audio/" else "video/") == true
      } ?: error("Selected media track is unavailable")
      reader.selectTrack(index)
      val format = reader.getTrackFormat(index)
      val mime = requireNotNull(format.getString(MediaFormat.KEY_MIME))
      if (!audio) format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      else format.setInteger(MediaFormat.KEY_PCM_ENCODING, android.media.AudioFormat.ENCODING_PCM_16BIT)
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()
      var inputEnded = false
      var decodedFormat = format
      var lastVideoUs = -1000000L
      val info = MediaCodec.BufferInfo()
      while (running.get() && sink.isRequestingFrames) {
        if (!inputEnded) {
          val input = codec.dequeueInputBuffer(10000)
          if (input >= 0) {
            val buffer = requireNotNull(codec.getInputBuffer(input))
            val count = reader.readSampleData(buffer, 0)
            if (count < 0) {
              codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputEnded = true
            } else {
              codec.queueInputBuffer(input, 0, count, reader.sampleTime, 0)
              reader.advance()
            }
          }
        }
        val output = codec.dequeueOutputBuffer(info, 10000)
        if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) decodedFormat = codec.outputFormat
        if (output < 0) continue
        try {
          if (info.size > 0 && info.presentationTimeUs >= 0) {
            val targetUs = anchorUs + info.presentationTimeUs
            val due = audio || info.presentationTimeUs - lastVideoUs >= 1000000L / fps
            if (due && await(targetUs, sink)) {
              if (audio) {
                val buffer = requireNotNull(codec.getOutputBuffer(output)).duplicate()
                buffer.position(info.offset); buffer.limit(info.offset + info.size)
                val encoding = if (decodedFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) decodedFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) else android.media.AudioFormat.ENCODING_PCM_16BIT
                require(encoding == android.media.AudioFormat.ENCODING_PCM_16BIT)
                sink.pushAudio(buffer.slice(), decodedFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE),
                  decodedFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT), targetUs)
              } else {
                val image = requireNotNull(codec.getOutputImage(output))
                try {
                  sink.pushVideo(image, targetUs, rotation)
                  lastVideoUs = info.presentationTimeUs
                } finally { image.close() }
              }
            }
          }
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        } finally { codec.releaseOutputBuffer(output, false) }
      }
    } finally {
      try { codec?.stop() } finally { codec?.release(); reader.release() }
    }
  }

  /** Keeps both decoders paced to the shared monotonic timeline and drops stale frames. */
  private fun await(targetUs: Long, sink: RealtimeExternalFrameSink): Boolean {
    while (running.get() && sink.isRequestingFrames) {
      val remaining = targetUs - SystemClock.elapsedRealtimeNanos() / 1000
      if (remaining <= 0) return remaining >= -100000
      LockSupport.parkNanos(minOf(remaining * 1000, 10000000L))
      if (Thread.interrupted()) return false
    }
    return false
  }
}

/** Bridges source preparation and attachment without transferring video or audio through JS. */
private class XLabExternalCapture(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val sources = ConcurrentHashMap<String, XLabFileVideoSource>()
  private val worker = Executors.newCachedThreadPool()
  override fun getName() = "XLabExternalCapture"

  @ReactMethod fun prepare(fileURL: String, fps: Double, promise: Promise) {
    worker.execute {
      try {
        require(fps.isFinite() && fps == fps.toInt().toDouble())
        val source = XLabFileVideoSource(context, Uri.parse(fileURL), fps.toInt())
        val id = UUID.randomUUID().toString()
        sources[id] = source
        promise.resolve(Arguments.createMap().apply {
          putString("sourceID", id); putInt("width", source.width); putInt("height", source.height)
          putInt("fps", fps.toInt()); putBoolean("hasAudio", source.hasAudio)
        })
      } catch (error: Exception) { promise.reject("MEDIA_ERROR", "Unable to prepare external video", error) }
    }
  }

  @ReactMethod fun start(sourceID: String, sink: String, promise: Promise) {
    try {
      requireNotNull(sources[sourceID]).start(requireNotNull(RealtimeExternalFrameSink.find(sink)))
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("MEDIA_ERROR", "Unable to start external video", error) }
  }

  @ReactMethod fun stop(sourceID: String, promise: Promise) {
    worker.execute {
      try { sources.remove(sourceID)?.stop(); promise.resolve(null) }
      catch (error: Exception) { promise.reject("MEDIA_ERROR", "Unable to stop external video", error) }
    }
  }

  override fun invalidate() {
    val previous = sources.values.toList()
    sources.clear()
    worker.execute { previous.forEach { it.stop() } }
    worker.shutdown()
    super.invalidate()
  }
}

/** Installs XLab's app-owned decoder module alongside autolinked SDK modules. */
class XLabExternalCapturePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(XLabExternalCapture(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
