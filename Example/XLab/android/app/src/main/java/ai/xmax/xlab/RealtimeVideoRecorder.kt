package ai.xmax.xlab

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import ai.xmax.reactnative.RealtimeAudioFrame
import ai.xmax.reactnative.RealtimeMediaFrame
import ai.xmax.reactnative.RealtimeVideoFrame
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executors

/** Encodes owned remote video and PCM on a bounded serial queue, then saves an MP4 to Movies. */
internal class RealtimeVideoRecorder(private val context: Context) {
  private val worker = Executors.newSingleThreadExecutor()
  private val admission = Any()
  private var acceptingID: String? = null
  private var closed = false
  private var retainedBytes = 0L
  private var retainedPackets = 0
  @Volatile private var failure: String? = null

  // Only the encoder worker accesses track and recording state.
  private var recordingID: String? = null
  private var streamID: String? = null
  private var directory: File? = null
  private var video: Track? = null
  private var audio: Track? = null

  /** Owns one encoder and temporary track; original PTS offsets are restored when muxing. */
  private class Track(
    val file: File,
    val codec: MediaCodec,
    val muxer: MediaMuxer,
    val origin: Long,
    val format: List<Int>,
    val rotation: Int = 0,
  ) {
    var trackIndex = -1
    var started = false
    var lastPTS = -1L
    var endPTS = 0L
    var samples = 0L
  }

  fun error(): String? = failure

  fun start(completion: (String?) -> Unit) {
    synchronized(admission) {
      if (closed) { completion("record.notRecording"); return }
      worker.execute {
        try {
          synchronized(admission) {
            check(!closed) { "record.notRecording" }
            check(recordingID == null) { "record.alreadyRecording" }
            val id = UUID.randomUUID().toString()
            directory = File(context.cacheDir, "record-$id").also { check(it.mkdirs()) }
            recordingID = id
            failure = null
            acceptingID = id
          }
          completion(null)
        } catch (error: Exception) { completion(key(error)) }
      }
    }
  }

  /** Retains SDK-owned buffers only while their bounded encoder task is pending. */
  fun append(frame: RealtimeMediaFrame) {
    val bytes = when (val media = frame.content) {
      is RealtimeAudioFrame -> media.data.remaining().toLong()
      is RealtimeVideoFrame -> media.y.remaining().toLong() + media.u.remaining() + media.v.remaining()
    }
    synchronized(admission) {
      val id = acceptingID ?: return
      if (retainedPackets >= 512 || bytes > 32L * 1024 * 1024 - retainedBytes) {
        acceptingID = null
        worker.execute { if (recordingID == id) fail("record.bufferFull") }
        return
      }
      retainedPackets++
      retainedBytes += bytes
      worker.execute {
        try {
          if (recordingID == id) encode(frame)
        } catch (error: Exception) { fail(key(error)) }
        finally {
          synchronized(admission) { retainedPackets--; retainedBytes -= bytes }
        }
      }
    }
  }

  /** Stops admission before finalizing codecs, restoring A/V offsets, and publishing to MediaStore. */
  fun stopAndSave(completion: (String?, String?) -> Unit) {
    synchronized(admission) {
      if (closed) { completion(null, "record.notRecording"); return }
      acceptingID = null
      worker.execute {
        try {
          failure?.let { error(it) }
          check(recordingID != null) { "record.notRecording" }
          val video = checkNotNull(video) { "record.noFrames" }
          finish(video)
          audio?.let { finish(it) }
          val output = File(checkNotNull(directory), "recording.mp4")
          combine(output, video, audio)
          completion(save(output), null)
        } catch (error: Exception) { completion(null, key(error)) }
        finally { reset() }
      }
    }
  }

  fun close() {
    synchronized(admission) {
      if (closed) return
      closed = true
      acceptingID = null
      worker.execute { reset() }
      worker.shutdown()
    }
  }

  private fun encode(packet: RealtimeMediaFrame) {
    check(packet.presentationTimeStamp >= 0) { "record.timelineChanged" }
    check(streamID == null || streamID == packet.streamID) { "record.timelineChanged" }
    streamID = packet.streamID
    when (val frame = packet.content) {
      is RealtimeVideoFrame -> {
        if (video == null) video = prepareVideo(frame)
        val track = checkNotNull(video)
        check(track.format == listOf(frame.width, frame.height, frame.rotation)) { "record.sizeChanged" }
        val pts = frame.presentationTimeStamp - track.origin
        check(pts > track.lastPTS) { "record.timelineChanged" }
        val index = inputIndex(track)
        val image = checkNotNull(track.codec.getInputImage(index)) { "record.encoderFailed" }
        image.use {
          val sources = listOf(frame.y, frame.u, frame.v)
          image.planes.forEachIndexed { planeIndex, plane ->
            val width = if (planeIndex == 0) frame.width else frame.width / 2
            val height = if (planeIndex == 0) frame.height else frame.height / 2
            val source = sources[planeIndex].duplicate()
            val target = plane.buffer.duplicate()
            val offset = target.position()
            for (row in 0 until height) {
              val destination = offset + row * plane.rowStride
              if (plane.pixelStride == 1) {
                val line = source.duplicate().apply { limit(position() + width) }
                target.position(destination)
                target.put(line)
                source.position(source.position() + width)
              } else {
                for (column in 0 until width) {
                  target.put(destination + column * plane.pixelStride, source.get())
                }
              }
            }
          }
        }
        track.codec.queueInputBuffer(index, 0, frame.width * frame.height * 3 / 2, pts, 0)
        track.lastPTS = pts
        track.endPTS = pts + 33_333
        drain(track)
      }
      is RealtimeAudioFrame -> {
        check(frame.sampleRate in 8000..192000 && frame.channels in 1..2 &&
          frame.samplesPerChannel in 1..192000 &&
          frame.data.remaining() == frame.samplesPerChannel * frame.channels * 2) { "record.encoderFailed" }
        if (audio == null) audio = prepareAudio(frame)
        val track = checkNotNull(audio)
        check(track.format == listOf(frame.sampleRate, frame.channels)) { "record.timelineChanged" }
        val pts = frame.presentationTimeStamp - track.origin
        check(pts > track.lastPTS) { "record.timelineChanged" }
        val desiredSamples = (pts * frame.sampleRate + 500_000) / 1_000_000
        val gap = desiredSamples - track.samples
        check(gap in -1..frame.sampleRate * 10L) { "record.timelineChanged" }
        var silence = gap.coerceAtLeast(0)
        while (silence > 0) {
          val count = minOf(silence, 4800).toInt()
          encodeAudio(track, ByteBuffer.allocate(count * frame.channels * 2))
          silence -= count
        }
        encodeAudio(track, frame.data.duplicate())
        track.lastPTS = pts
      }
    }
  }

  private fun prepareVideo(frame: RealtimeVideoFrame): Track {
    check(frame.width > 0 && frame.height > 0 && frame.width % 2 == 0 && frame.height % 2 == 0 &&
      frame.rotation in listOf(0, 90, 180, 270)) { "record.invalidSize" }
    val format = MediaFormat.createVideoFormat("video/avc", frame.width, frame.height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, (frame.width.toLong() * frame.height * 4).coerceIn(500_000, 12_000_000).toInt())
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      if (Build.VERSION.SDK_INT >= 29) setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
    }
    return prepare(format, "video.mp4", frame.presentationTimeStamp,
      listOf(frame.width, frame.height, frame.rotation), frame.rotation)
  }

  private fun prepareAudio(frame: RealtimeAudioFrame): Track {
    val format = MediaFormat.createAudioFormat("audio/mp4a-latm", frame.sampleRate, frame.channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, 96_000 * frame.channels)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    return prepare(format, "audio.m4a", frame.presentationTimeStamp, listOf(frame.sampleRate, frame.channels))
  }

  private fun prepare(format: MediaFormat, name: String, origin: Long, dimensions: List<Int>, rotation: Int = 0): Track {
    val encoder = checkNotNull(MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format)) { "record.encoderFailed" }
    val codec = MediaCodec.createByCodecName(encoder)
    var muxer: MediaMuxer? = null
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      val file = File(checkNotNull(directory), name)
      muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      if (rotation != 0) muxer.setOrientationHint(rotation)
      return Track(file, codec, muxer, origin, dimensions, rotation)
    } catch (error: Exception) {
      runCatching { codec.release() }
      runCatching { muxer?.release() }
      throw error
    }
  }

  private fun encodeAudio(track: Track, source: ByteBuffer) {
    val sampleRate = track.format[0]
    val bytesPerSample = track.format[1] * 2
    while (source.hasRemaining()) {
      val index = inputIndex(track)
      val target = checkNotNull(track.codec.getInputBuffer(index))
      target.clear()
      val bytes = minOf(target.remaining(), source.remaining()) / bytesPerSample * bytesPerSample
      check(bytes > 0) { "record.encoderFailed" }
      val chunk = source.duplicate().apply { limit(position() + bytes) }
      target.put(chunk)
      source.position(source.position() + bytes)
      track.codec.queueInputBuffer(index, 0, bytes, track.samples * 1_000_000 / sampleRate, 0)
      track.samples += bytes / bytesPerSample
      track.endPTS = track.samples * 1_000_000 / sampleRate
      drain(track)
    }
  }

  private fun inputIndex(track: Track): Int {
    val deadline = System.nanoTime() + 2_000_000_000L
    while (System.nanoTime() < deadline) {
      val index = track.codec.dequeueInputBuffer(10_000)
      if (index >= 0) return index
      drain(track)
    }
    error("record.encoderFailed")
  }

  /** Drains immediately available output or waits for EOS under a fixed finish deadline. */
  private fun drain(track: Track, finishing: Boolean = false) {
    val info = MediaCodec.BufferInfo()
    val deadline = System.nanoTime() + 10_000_000_000L
    while (true) {
      check(System.nanoTime() < deadline) { "record.encoderFailed" }
      val index = track.codec.dequeueOutputBuffer(info, if (finishing) 10_000 else 0)
      when {
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          check(!track.started) { "record.encoderFailed" }
          track.trackIndex = track.muxer.addTrack(track.codec.outputFormat)
          track.muxer.start()
          track.started = true
        }
        index >= 0 -> {
          try {
            if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
              check(track.started) { "record.encoderFailed" }
              track.muxer.writeSampleData(track.trackIndex, checkNotNull(track.codec.getOutputBuffer(index)), info)
            }
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
          } finally { track.codec.releaseOutputBuffer(index, false) }
        }
        index == MediaCodec.INFO_TRY_AGAIN_LATER && !finishing -> return
      }
    }
  }

  private fun finish(track: Track) {
    val index = inputIndex(track)
    track.codec.queueInputBuffer(index, 0, 0, track.endPTS, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    drain(track, finishing = true)
    check(track.started) { "record.noFrames" }
    track.muxer.stop()
    track.started = false
  }

  /** Remuxes independently encoded tracks using their original shared clock offsets. */
  private fun combine(output: File, video: Track, audio: Track?) {
    val tracks = listOfNotNull(video, audio)
    val origin = tracks.minOf { it.origin }
    val muxer = MediaMuxer(output.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val readers = mutableListOf<MediaExtractor>()
    var started = false
    try {
      muxer.setOrientationHint(video.rotation)
      val indices = tracks.map { track ->
        val reader = MediaExtractor().also { readers.add(it) }
        reader.setDataSource(track.file.path)
        check(reader.trackCount == 1) { "record.trackFailed" }
        reader.selectTrack(0)
        muxer.addTrack(reader.getTrackFormat(0))
      }
      muxer.start()
      started = true
      var buffer = ByteBuffer.allocateDirect(1024 * 1024)
      val info = MediaCodec.BufferInfo()
      tracks.forEachIndexed { index, track ->
        val reader = readers[index]
        while (reader.sampleTime >= 0) {
          val size = reader.sampleSize
          check(size in 1..32L * 1024 * 1024) { "record.bufferFull" }
          if (buffer.capacity() < size) buffer = ByteBuffer.allocateDirect(size.toInt())
          buffer.clear()
          val count = reader.readSampleData(buffer, 0)
          if (count < 0) break
          info.set(0, count, reader.sampleTime + track.origin - origin,
            if (reader.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
          muxer.writeSampleData(indices[index], buffer, info)
          reader.advance()
        }
      }
      muxer.stop()
      started = false
    } finally {
      readers.forEach { it.release() }
      if (started) runCatching { muxer.stop() }
      muxer.release()
    }
  }

  private fun save(file: File): String {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, "XLab-${System.currentTimeMillis()}.mp4")
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      if (Build.VERSION.SDK_INT >= 29) {
        put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/XLab")
        put(MediaStore.Video.Media.IS_PENDING, 1)
      } else {
        val folder = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "XLab")
        check(folder.isDirectory || folder.mkdirs()) { "record.saveFailed" }
        put(MediaStore.Video.Media.DATA, File(folder, getAsString(MediaStore.Video.Media.DISPLAY_NAME)).path)
      }
    }
    val uri = checkNotNull(resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)) { "record.saveFailed" }
    try {
      checkNotNull(resolver.openOutputStream(uri)).use { output -> file.inputStream().use { it.copyTo(output) } }
      if (Build.VERSION.SDK_INT >= 29) resolver.update(uri,
        ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
      return uri.toString()
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      error("record.saveFailed")
    }
  }

  private fun fail(reason: String) {
    failure = reason
    synchronized(admission) { acceptingID = null }
    reset()
  }

  private fun reset() {
    synchronized(admission) { acceptingID = null }
    listOfNotNull(video, audio).forEach { track ->
      runCatching { track.codec.stop() }
      runCatching { track.codec.release() }
      if (track.started) runCatching { track.muxer.stop() }
      runCatching { track.muxer.release() }
    }
    video = null
    audio = null
    directory?.deleteRecursively()
    directory = null
    streamID = null
    recordingID = null
  }

  private fun key(error: Exception): String {
    return error.message?.takeIf { it.startsWith("record.") } ?: "record.failed"
  }
}
