import CoreMedia
import CoreVideo
import Foundation

@main struct RemoteMediaFrameChecks {
  static func main() {
    let timelineInput = RtcRemoteAudioFrame(data: Data(repeating: 7, count: 960), sampleRate: 48000,
      channels: 1, samplesPerChannel: 480, renderTimeMs: 1000)
    var timeline = RemoteAudioTimeline()
    let first = timeline.resolve(timelineInput)!
    let batched = timeline.resolve(timelineInput)!
    precondition(first.discontinuous && !batched.discontinuous)
    precondition(CMTimeCompare(first.frame.presentationTimeStamp, CMTime(value: 1000, timescale: 1000)) == 0)
    precondition(CMTimeCompare(batched.frame.presentationTimeStamp, CMTime(value: 1010, timescale: 1000)) == 0)
    let gap = timeline.resolve(RtcRemoteAudioFrame(data: timelineInput.data, sampleRate: 48000,
      channels: 1, samplesPerChannel: 480, renderTimeMs: 2000))!
    precondition(gap.discontinuous && CMTimeGetSeconds(gap.frame.presentationTimeStamp) == 2)

    let queue = DispatchQueue(label: "test.media-output")
    let dispatcher = RealtimeMediaFrameDispatcher(maximumPendingFrames: 1, maximumPendingBytes: 1024, deliveryQueue: queue)
    let frames = CollectedFrames()
    let identity = UUID()
    dispatcher.setStream(identity)
    dispatcher.setListener { frames.append($0) }
    queue.suspend()
    dispatcher.dispatchAudio(timelineInput, streamID: identity)
    dispatcher.dispatchAudio(timelineInput, streamID: identity)
    queue.resume()
    queue.sync {}
    precondition(frames.values.count == 1 && frames.values[0].isDiscontinuous)
    dispatcher.dispatchAudio(timelineInput, streamID: identity)
    queue.sync {}
    precondition(frames.values.count == 2 && frames.values[1].isDiscontinuous)
    precondition(CMTimeGetSeconds(frames.values[1].presentationTimeStamp) == 1.02)

    queue.suspend()
    dispatcher.dispatchAudio(timelineInput, streamID: identity)
    dispatcher.setListener(nil)
    queue.resume()
    queue.sync {}
    precondition(frames.values.count == 2, "Removed listeners must not receive queued output")
    let replacement = UUID()
    dispatcher.setStream(replacement)
    dispatcher.setListener { frames.append($0) }
    dispatcher.dispatchAudio(timelineInput, streamID: identity)
    queue.sync {}
    precondition(frames.values.count == 2, "A retired stream must not reach a replacement")

    var buffer: CVPixelBuffer?
    precondition(CVPixelBufferCreate(kCFAllocatorDefault, 2, 2, kCVPixelFormatType_32BGRA, nil, &buffer) == kCVReturnSuccess)
    let video = RealtimeVideoFrame(pixelBuffer: buffer!, presentationTimeStamp: CMTime(value: 1500, timescale: 1000))
    dispatcher.dispatchVideo(video, streamID: replacement)
    queue.sync {}
    let output = frames.values.last!
    precondition(output.streamID == replacement && output.isDiscontinuous)
    precondition(CMTimeGetSeconds(output.presentationTimeStamp) == 1.5)
    let consumer = RealtimeMediaFrameConsumer { frames.append($0) }
    precondition(RealtimeMediaFrameConsumer.find(consumer.nativeHandle) === consumer)
    consumer.receive(output)
    let count = frames.values.count
    consumer.invalidate()
    consumer.receive(output)
    precondition(frames.values.count == count)
    precondition(RealtimeMediaFrameConsumer.find(consumer.nativeHandle) == nil)
    print("Remote media frame checks passed")
  }
}

final class CollectedFrames: @unchecked Sendable {
  private let lock = NSLock()
  private var frames: [RealtimeMediaFrame] = []
  var values: [RealtimeMediaFrame] { lock.withLock { frames } }
  func append(_ frame: RealtimeMediaFrame) { lock.withLock { frames.append(frame) } }
}
