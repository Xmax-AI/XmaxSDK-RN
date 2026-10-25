import AVFoundation
import CoreMedia
import Foundation

struct XmaxNativeFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

private func samples(_ count: Int = 480, time: CMTime = .zero, channels: AVAudioChannelCount = 1,
  value: Int16 = 1000) throws -> CMSampleBuffer {
  let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: channels, interleaved: true)!
  let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
  pcm.frameLength = AVAudioFrameCount(count)
  for buffer in UnsafeMutableAudioBufferListPointer(pcm.mutableAudioBufferList) {
    buffer.mData!.assumingMemoryBound(to: Int16.self).initialize(repeating: value, count: Int(buffer.mDataByteSize) / 2)
  }
  var description: CMAudioFormatDescription?
  precondition(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: format.streamDescription,
    layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil,
    formatDescriptionOut: &description) == noErr)
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: time,
    decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  precondition(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
    makeDataReadyCallback: nil, refcon: nil, formatDescription: description!, sampleCount: count,
    sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
    sampleBufferOut: &sample) == noErr)
  precondition(CMSampleBufferSetDataBufferFromAudioBufferList(sample!, blockBufferAllocator: kCFAllocatorDefault,
    blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: pcm.audioBufferList) == noErr)
  precondition(CMSampleBufferSetDataReady(sample!) == noErr)
  return sample!
}

@main struct ExternalAudioChecks {
  static func main() throws {
    let converter = XmaxExternalAudioFrameConverter()
    var frames: [XmaxExternalAudioFrame] = []
    try converter.append(samples(960, time: CMTime(value: 1, timescale: 1))) { frames.append($0) }
    precondition(frames.map(\.timestampUs) == [1000000, 1010000])
    precondition(frames.allSatisfy { $0.data.count == 960 })
    try converter.append(samples(time: CMTime(value: 1, timescale: 1))) { _ in preconditionFailure("Overlap delivered") }
    converter.discardPendingAudio()
    do {
      try converter.append(samples(time: CMTime(value: 2, timescale: 1), channels: 2)) { _ in }
      preconditionFailure("Format changed after discarding")
    } catch is XmaxNativeFailure { }
    try converter.append(samples(240, time: CMTime(value: 2, timescale: 1), value: 3)) { _ in preconditionFailure() }
    converter.discardPendingAudio()
    try converter.append(samples(480, time: CMTime(value: 2005, timescale: 1000), value: 7)) { frames.append($0) }
    precondition(frames.count == 3 && frames[2].timestampUs == 2005000)
    precondition(frames[2].data.withUnsafeBytes { $0.load(as: Int16.self) } == 7)
    try converter.append(samples(time: .invalid)) { _ in preconditionFailure("Invalid time delivered") }
    print("External PCM checks passed")
  }
}
