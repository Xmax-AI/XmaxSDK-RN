@preconcurrency import AVFoundation
import Foundation
import XmaxReactNativeSDK

/// Encodes remote video and PCM into an MP4 with their shared presentation timeline.
final class RealtimeVideoRecorder: @unchecked Sendable {

  enum RecorderError: LocalizedError, Sendable {
    case alreadyRecording
    case notRecording
    case noFrames
    case videoFormatChanged
    case timelineChanged
    case bufferFull
    case writingFailed(String)

    var errorDescription: String? {
      switch self {
      case .alreadyRecording: "record.alreadyRecording"
      case .notRecording: "record.notRecording"
      case .noFrames: "record.noFrames"
      case .videoFormatChanged: "record.sizeChanged"
      case .timelineChanged: "record.timelineChanged"
      case .bufferFull: "record.bufferFull"
      case .writingFailed: "record.failed"
      }
    }
  }

  private enum State {
    case idle, recording, finishing
  }

  private struct Packet {
    let frame: RealtimeMediaFrame
    let bytes: Int
  }

  /// Encodes each track from zero and restores its original offset when combining tracks.
  private final class Track: @unchecked Sendable {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let origin: CMTime
    let format: [Int]
    let videoAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    let audioDescription: CMAudioFormatDescription?
    var pending: [Packet] = []
    var lastQueuedPTS = CMTime.invalid
    var lastQueuedEnd = CMTime.invalid
    var endTime = CMTime.zero
    var finishing = false
    var finished = false

    init(
      writer: AVAssetWriter,
      input: AVAssetWriterInput,
      origin: CMTime,
      format: [Int],
      videoAdaptor: AVAssetWriterInputPixelBufferAdaptor? = nil,
      audioDescription: CMAudioFormatDescription? = nil
    ) {
      self.writer = writer
      self.input = input
      self.origin = origin
      self.format = format
      self.videoAdaptor = videoAdaptor
      self.audioDescription = audioDescription
    }
  }

  typealias FailureListener = @Sendable (RecorderError) -> Void

  private let failureListener: FailureListener
  private let recordingQueue = DispatchQueue(
    label: "ai.xmax.xlab.realtime-media-recorder",
    qos: .userInitiated
  )

  // Bound both admission and encoder backpressure to avoid retaining unlimited media.
  private let admissionLock = NSLock()
  private let maximumPendingBytes: Int
  private let maximumPendingPackets: Int
  private var acceptingID: UUID?
  private var retainedBytes = 0
  private var retainedPackets = 0

  // The recording queue exclusively owns the following state.
  private var state = State.idle
  private var recordingID: UUID?
  private var streamID: UUID?
  private var directory: URL?
  private var outputURL: URL?
  private var video: Track?
  private var audio: Track?
  private var isDrainScheduled = false
  private var isExporting = false
  private var finishDeadline: UInt64?
  private var finishContinuation: CheckedContinuation<URL, any Swift.Error>?

  init(
    maximumPendingBytes: Int = 32 * 1_024 * 1_024,
    maximumPendingPackets: Int = 512,
    failureListener: @escaping FailureListener
  ) {
    self.maximumPendingBytes = maximumPendingBytes
    self.maximumPendingPackets = maximumPendingPackets
    self.failureListener = failureListener
  }

  /// Starts recording subsequent remote media without changing subscriptions or playback volume.
  func start() throws {
    try recordingQueue.sync {
      guard state == .idle else { throw RecorderError.alreadyRecording }
      let id = UUID()
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
        id.uuidString,
        isDirectory: true
      )
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      self.directory = directory
      outputURL = directory.deletingLastPathComponent().appendingPathComponent(
        id.uuidString + ".mp4"
      )
      recordingID = id
      state = .recording
      admissionLock.withLock { acceptingID = id }
    }
  }

  /// Retains owned media for bounded encoding outside the SDK delivery queue.
  func append(_ frame: RealtimeMediaFrame) {
    let bytes: Int
    switch frame.content {
    case .audio(let audio): bytes = audio.data.count
    case .video(let video): bytes = CVPixelBufferGetDataSize(video.pixelBuffer)
    }
    admissionLock.withLock {
      guard let id = acceptingID else { return }
      guard retainedPackets < maximumPendingPackets,
        bytes <= maximumPendingBytes - retainedBytes
      else {
        acceptingID = nil
        recordingQueue.async { [weak self] in
          guard let self, recordingID == id else { return }
          fail(.bufferFull)
        }
        return
      }
      retainedPackets += 1
      retainedBytes += bytes
      let packet = Packet(frame: frame, bytes: bytes)
      recordingQueue.async { [weak self] in self?.enqueue(packet, recordingID: id) }
    }
  }

  /// Finishes encoding and returns an MP4, including audio only when received.
  func stop() async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      admissionLock.withLock {
        acceptingID = nil
        recordingQueue.async { [self] in
          guard state == .recording else {
            continuation.resume(throwing: RecorderError.notRecording)
            return
          }
          state = .finishing
          finishContinuation = continuation
          finishDeadline = DispatchTime.now().uptimeNanoseconds + 10_000_000_000
          guard video != nil else {
            fail(.noFrames)
            return
          }
          drainFrames()
        }
      }
    }
  }
  /// Discards an unfinished recording when its native owner is invalidated.
  func cancel() {
    admissionLock.withLock { acceptingID = nil }
    recordingQueue.async { [self] in
      let continuation = finishContinuation
      finishContinuation = nil
      resetResources()
      continuation?.resume(throwing: RecorderError.notRecording)
    }
  }

}

extension RealtimeVideoRecorder {
  private func enqueue(_ packet: Packet, recordingID id: UUID) {
    guard recordingID == id, state == .recording else {
      release(packet)
      return
    }
    do {
      let event = packet.frame
      guard event.presentationTimeStamp.isNumeric else { throw RecorderError.timelineChanged }
      if let streamID, streamID != event.streamID { throw RecorderError.timelineChanged }
      streamID = event.streamID
      let track: Track
      let duration: CMTime
      switch event.content {
      case .video(let frame):
        if video == nil { video = try prepareVideo(frame) }
        guard let video else { throw RecorderError.noFrames }
        guard
          video.format == [
            CVPixelBufferGetWidth(frame.pixelBuffer), CVPixelBufferGetHeight(frame.pixelBuffer),
          ]
        else {
          throw RecorderError.videoFormatChanged
        }
        track = video
        duration = Self.validVideoDuration(frame.duration)
      case .audio(let frame):
        guard (8_000...192_000).contains(frame.sampleRate),
          (1...2).contains(frame.channels), frame.samplesPerChannel > 0,
          frame.samplesPerChannel <= 192_000,
          frame.data.count == frame.samplesPerChannel * frame.channels * 2
        else {
          throw RecorderError.writingFailed("record.encoderFailed")
        }
        if audio == nil { audio = try prepareAudio(frame) }
        guard let audio, audio.format == [frame.sampleRate, frame.channels] else {
          throw RecorderError.timelineChanged
        }
        track = audio
        duration = frame.duration
      }
      if track.lastQueuedPTS.isNumeric {
        guard event.presentationTimeStamp > track.lastQueuedPTS else {
          throw RecorderError.timelineChanged
        }
        if case .audio = event.content, event.presentationTimeStamp < track.lastQueuedEnd {
          throw RecorderError.timelineChanged
        }
      }
      track.lastQueuedPTS = event.presentationTimeStamp
      track.lastQueuedEnd = event.presentationTimeStamp + duration
      track.pending.append(packet)
    } catch {
      release(packet)
      fail((error as? RecorderError) ?? .writingFailed(error.localizedDescription))
      return
    }
    drainFrames()
  }

  private func prepareVideo(_ frame: RealtimeVideoFrame) throws -> Track {
    let width = CVPixelBufferGetWidth(frame.pixelBuffer)
    let height = CVPixelBufferGetHeight(frame.pixelBuffer)
    guard width > 0, height > 0, width.isMultiple(of: 2), height.isMultiple(of: 2), let directory
    else {
      throw RecorderError.writingFailed("record.invalidSize")
    }
    let writer = try AVAssetWriter(
      outputURL: directory.appendingPathComponent("video.mp4"),
      fileType: .mp4
    )
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAllowFrameReorderingKey: false],
      ]
    )
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else { throw Self.writerError(writer) }
    writer.add(input)
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: nil
    )
    guard writer.startWriting() else { throw Self.writerError(writer) }
    writer.startSession(atSourceTime: .zero)
    return Track(
      writer: writer,
      input: input,
      origin: frame.presentationTimeStamp,
      format: [width, height],
      videoAdaptor: adaptor
    )
  }

  private func prepareAudio(_ frame: RealtimeAudioFrame) throws -> Track {
    guard let directory else { throw RecorderError.notRecording }
    let description = try Self.audioDescription(frame)
    let writer = try AVAssetWriter(
      outputURL: directory.appendingPathComponent("audio.m4a"),
      fileType: .m4a
    )
    let input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 48_000,
        AVNumberOfChannelsKey: frame.channels,
        AVEncoderBitRateKey: 96_000 * frame.channels,
      ],
      sourceFormatHint: description
    )
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else { throw Self.writerError(writer) }
    writer.add(input)
    guard writer.startWriting() else { throw Self.writerError(writer) }
    writer.startSession(atSourceTime: .zero)
    return Track(
      writer: writer,
      input: input,
      origin: frame.presentationTimeStamp,
      format: [frame.sampleRate, frame.channels],
      audioDescription: description
    )
  }

  private func drainFrames() {
    isDrainScheduled = false
    guard state != .idle else { return }
    if let deadline = finishDeadline, DispatchTime.now().uptimeNanoseconds > deadline, !isExporting
    {
      fail(.writingFailed("record.encoderFailed"))
      return
    }
    do {
      for track in [video, audio].compactMap({ $0 }) where !track.finishing {
        guard track.writer.status == .writing else { throw Self.writerError(track.writer) }
        while track.input.isReadyForMoreMediaData, let packet = track.pending.first {
          let pts = packet.frame.presentationTimeStamp - track.origin
          switch packet.frame.content {
          case .video(let frame):
            guard track.videoAdaptor?.append(frame.pixelBuffer, withPresentationTime: pts) == true
            else {
              throw Self.writerError(track.writer)
            }
            track.endTime = pts + Self.validVideoDuration(frame.duration)
          case .audio(let frame):
            let gap = CMTimeConvertScale(
              pts - track.endTime,
              timescale: Int32(frame.sampleRate),
              method: .roundHalfAwayFromZero
            ).value
            guard gap <= Int64(frame.sampleRate * 10), gap >= -1 else {
              throw RecorderError.timelineChanged
            }
            if gap > 0 {
              // Insert silence to preserve PCM gaps in the continuous AAC sample timeline.
              // Observe backpressure between chunks and reject excessive clock jumps.
              let count = Int(min(gap, 4_800))
              let silence = try Self.audioSample(
                data: Data(repeating: 0, count: count * frame.channels * 2),
                samplesPerChannel: count,
                description: track.audioDescription,
                pts: track.endTime
              )
              guard track.input.append(silence) else { throw Self.writerError(track.writer) }
              track.endTime =
                track.endTime
                + CMTime(value: Int64(count), timescale: Int32(frame.sampleRate))
              continue
            }
            let sample = try Self.audioSample(
              data: frame.data,
              samplesPerChannel: frame.samplesPerChannel,
              description: track.audioDescription,
              pts: track.endTime
            )
            guard track.input.append(sample) else { throw Self.writerError(track.writer) }
            track.endTime = track.endTime + frame.duration
          }
          track.pending.removeFirst()
          release(packet)
        }
        if state == .finishing, track.pending.isEmpty { finish(track) }
      }
      if [video, audio].compactMap({ $0 }).contains(where: { !$0.pending.isEmpty }) {
        scheduleDrainRetry()
      }
    } catch {
      fail((error as? RecorderError) ?? .writingFailed(error.localizedDescription))
    }
  }

  private func scheduleDrainRetry() {
    guard !isDrainScheduled, let id = recordingID else { return }
    isDrainScheduled = true
    recordingQueue.asyncAfter(deadline: .now() + 0.005) { [weak self] in
      guard let self, recordingID == id else { return }
      drainFrames()
    }
  }

  private func finish(_ track: Track) {
    guard !track.finishing, let id = recordingID else { return }
    track.finishing = true
    track.writer.endSession(atSourceTime: track.endTime)
    track.input.markAsFinished()
    track.writer.finishWriting { [weak self, track] in
      guard let self else { return }
      recordingQueue.async { [self, track] in
        guard self.recordingID == id else { return }
        guard track.writer.status == .completed else {
          self.fail(Self.writerError(track.writer))
          return
        }
        track.finished = true
        self.completeTracksIfReady()
      }
    }
  }

  private func completeTracksIfReady() {
    guard let video, video.finished, audio?.finished != false,
      !isExporting, let id = recordingID, let outputURL
    else { return }
    isExporting = true
    let audio = audio
    Task { [self] in
      do {
        if let audio {
          try await Self.combine(video: video, audio: audio, outputURL: outputURL)
        } else {
          try FileManager.default.moveItem(at: video.writer.outputURL, to: outputURL)
        }
        recordingQueue.async { [self] in
          guard recordingID == id else {
            try? FileManager.default.removeItem(at: outputURL)
            return
          }
          let continuation = finishContinuation
          finishContinuation = nil
          resetResources(keepsOutputFile: true)
          continuation?.resume(returning: outputURL)
        }
      } catch {
        let failure = RecorderError.writingFailed(error.localizedDescription)
        recordingQueue.async { [self] in
          guard recordingID == id else {
            try? FileManager.default.removeItem(at: outputURL)
            return
          }
          fail(failure)
        }
      }
    }
  }

  /// Restores both independently encoded tracks to their common presentation timeline.
  private static func combine(video: Track, audio: Track, outputURL: URL) async throws {
    let composition = AVMutableComposition()
    let origin = CMTimeMinimum(video.origin, audio.origin)
    for (track, mediaType) in [(video, AVMediaType.video), (audio, AVMediaType.audio)] {
      let asset = AVURLAsset(url: track.writer.outputURL)
      guard let source = try await asset.loadTracks(withMediaType: mediaType).first,
        let destination = composition.addMutableTrack(
          withMediaType: mediaType,
          preferredTrackID: kCMPersistentTrackID_Invalid
        )
      else {
        throw RecorderError.writingFailed("record.trackFailed")
      }
      try destination.insertTimeRange(
        CMTimeRange(start: .zero, duration: track.endTime),
        of: source,
        at: track.origin - origin
      )
      if mediaType == .video {
        destination.preferredTransform = try await source.load(.preferredTransform)
      }
    }
    guard
      let exporter = AVAssetExportSession(
        asset: composition,
        presetName: AVAssetExportPresetPassthrough
      )
    else {
      throw RecorderError.writingFailed("record.encoderFailed")
    }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    await withCheckedContinuation { continuation in
      exporter.exportAsynchronously { continuation.resume() }
    }
    guard exporter.status == .completed else {
      throw RecorderError.writingFailed(
        exporter.error?.localizedDescription ?? "record.encoderFailed"
      )
    }
  }

  private func release(_ packet: Packet) {
    admissionLock.withLock {
      retainedPackets -= 1
      retainedBytes -= packet.bytes
    }
  }

  private func fail(_ error: RecorderError) {
    let wasRecording = state == .recording
    let continuation = finishContinuation
    finishContinuation = nil
    resetResources()
    if let continuation {
      continuation.resume(throwing: error)
    } else if wasRecording {
      failureListener(error)
    }
  }

  private func resetResources(keepsOutputFile: Bool = false) {
    admissionLock.withLock { acceptingID = nil }
    for track in [video, audio].compactMap({ $0 }) {
      if track.writer.status == .writing || track.writer.status == .unknown {
        track.writer.cancelWriting()
      }
      for packet in track.pending { release(packet) }
    }
    if let directory { try? FileManager.default.removeItem(at: directory) }
    if !keepsOutputFile, let outputURL { try? FileManager.default.removeItem(at: outputURL) }
    video = nil
    audio = nil
    directory = nil
    outputURL = nil
    recordingID = nil
    streamID = nil
    state = .idle
    isDrainScheduled = false
    isExporting = false
    finishDeadline = nil
  }

  private static func audioDescription(_ frame: RealtimeAudioFrame) throws
    -> CMAudioFormatDescription
  {
    var asbd = AudioStreamBasicDescription(
      mSampleRate: Double(frame.sampleRate),
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
      mBytesPerPacket: UInt32(frame.channels * 2),
      mFramesPerPacket: 1,
      mBytesPerFrame: UInt32(frame.channels * 2),
      mChannelsPerFrame: UInt32(frame.channels),
      mBitsPerChannel: 16,
      mReserved: 0
    )
    var description: CMAudioFormatDescription?
    guard
      CMAudioFormatDescriptionCreate(
        allocator: kCFAllocatorDefault,
        asbd: &asbd,
        layoutSize: 0,
        layout: nil,
        magicCookieSize: 0,
        magicCookie: nil,
        extensions: nil,
        formatDescriptionOut: &description
      ) == noErr,
      let description
    else { throw RecorderError.writingFailed("record.encoderFailed") }
    return description
  }

  private static func audioSample(
    data: Data,
    samplesPerChannel: Int,
    description: CMAudioFormatDescription?,
    pts: CMTime
  ) throws -> CMSampleBuffer {
    var block: CMBlockBuffer?
    guard let description,
      CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: data.count,
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: data.count,
        flags: 0,
        blockBufferOut: &block
      ) == kCMBlockBufferNoErr,
      let block
    else { throw RecorderError.writingFailed("record.encoderFailed") }
    let result = data.withUnsafeBytes {
      CMBlockBufferReplaceDataBytes(
        with: $0.baseAddress!,
        blockBuffer: block,
        offsetIntoDestination: 0,
        dataLength: data.count
      )
    }
    var sample: CMSampleBuffer?
    guard result == noErr,
      CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: kCFAllocatorDefault,
        dataBuffer: block,
        formatDescription: description,
        sampleCount: samplesPerChannel,
        presentationTimeStamp: pts,
        packetDescriptions: nil,
        sampleBufferOut: &sample
      ) == noErr,
      let sample
    else { throw RecorderError.writingFailed("record.encoderFailed") }
    return sample
  }

  private static func validVideoDuration(_ duration: CMTime) -> CMTime {
    duration.isNumeric && duration > .zero ? duration : CMTime(value: 1, timescale: 24)
  }

  private static func writerError(_ writer: AVAssetWriter) -> RecorderError {
    .writingFailed(writer.error?.localizedDescription ?? "record.encoderFailed")
  }
}
