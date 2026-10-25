# Remote media frames

`setRemoteMediaFrameListener` delivers the result user's decoded video and pre-mix PCM to an app-owned native receiver. JavaScript registers a `RealtimeMediaFrameListener` descriptor containing the receiver's `nativeHandle`; it does not receive per-frame events or raw media bytes.

## Register from TypeScript

Create the native receiver through your app's native module and retain it there. Return its handle to JavaScript, then register it before generation or replace it while generating:

```ts
// Your app module creates and retains RealtimeMediaFrameConsumer on its native side.
const nativeHandle: string = await YourNativeModule.createMediaConsumer();
await realtime.setRemoteMediaFrameListener({ nativeHandle });

// Remove queued output before releasing your app-owned native receiver.
await realtime.setRemoteMediaFrameListener(null);
await YourNativeModule.releaseMediaConsumer(nativeHandle);
```

Registration does not change remote audio subscription or playback volume. Audio output becomes available after normal generation startup enables the result user's audio. Local preview audio is excluded. No mounted video view is required for output.

An invalid native handle rejects configuration when a result binding is available. Keep the consumer alive until removal completes. Disconnecting or stopping generation invalidates the current output binding and queued packets; the registration remains available for the next generation. Native background release and engine destruction also discard pending output.

## Swift

Import `XmaxReactNativeSDK`. Keep the consumer as a property of your app's native module or media coordinator:

```swift
private var consumer: RealtimeMediaFrameConsumer?

func createMediaConsumer() -> String {
    let consumer = RealtimeMediaFrameConsumer { frame in
        switch frame.content {
        case .audio(let audio):
            // Consume copied little-endian interleaved PCM16.
            processPCM(audio.data, sampleRate: audio.sampleRate,
                       channels: audio.channels, pts: audio.presentationTimeStamp)
        case .video(let video):
            // Consume owned upright BGRA. Retain it until asynchronous work finishes.
            processVideo(video.pixelBuffer, pts: video.presentationTimeStamp)
        }
    }
    self.consumer = consumer
    return consumer.nativeHandle
}

func releaseMediaConsumer() {
    consumer?.invalidate()
    consumer = nil
}
```

The `processPCM` and `processVideo` functions represent your app's implementation. Do not access UI directly from the callback. `CVPixelBuffer` data is read-only by contract; audio `Data` and retained video buffers remain valid after the callback returns.

## Kotlin

Import the native public types from `ai.xmax.reactnative`:

```kotlin
private var consumer: RealtimeMediaFrameConsumer? = null

fun createMediaConsumer(): String {
    val receiver = RealtimeMediaFrameConsumer { frame ->
        when (val media = frame.content) {
            is RealtimeAudioFrame -> {
                // Owned read-only PCM16. Timestamps are in microseconds.
                processPCM(media.data, media.sampleRate, media.channels,
                           media.presentationTimeStamp)
            }
            is RealtimeVideoFrame -> {
                // Owned tightly packed I420 planes. Apply rotation clockwise.
                processVideo(media.y, media.u, media.v, media.width,
                             media.height, media.rotation, media.presentationTimeStamp)
            }
        }
    }
    consumer = receiver
    return receiver.nativeHandle
}

fun releaseMediaConsumer() {
    consumer?.close()
    consumer = null
}
```

The example processing functions belong to your app. Plane strides are `width` for Y and `(width + 1) / 2` for U and V; chroma height is `(height + 1) / 2`. The read-only `ByteBuffer` data remains valid after delivery. Copy or duplicate buffer views if multiple application consumers need independent positions.

## Timing, bounds, and ownership

- Audio and video share one opaque `streamID` per result binding. Reconnection or restarting generation creates a new identity, even if the RTC account stays the same. Listener replacement within the same binding retains the identity.
- `presentationTimeStamp` uses the receiver rendering clock, not the source file timecode. Swift uses `CMTime`; Kotlin uses microseconds. Audio advances by sample count between explicit clock or format discontinuities. The initial timestamp need not be zero.
- Events are serialized in delivery order, not sorted across audio and video by timestamp. Buffer and schedule both tracks by PTS using one shared origin. Each event contains one audio or video packet, not a synchronized pair.
- `isDiscontinuous` marks the first event of each track, format or clock changes, and output following rejected packets. Handle gaps explicitly or begin a new recording segment. Dropped output does not compress the audio timeline.
- Each SDK output queue retains at most 256 packets and 32 MiB of media, including an executing callback. Slow receivers cause new output to be discarded. Forward packets promptly; your own asynchronous queues need their own limits.
- Removing the listener rejects queued output. A callback already executing may finish afterward. Stopping or closing the app-owned consumer disables further delivery; unregister it from the manager before releasing it.

This API supplies native media output. Recording, file muxing, frame interpolation, and a TypeScript raw-frame transport are separate capabilities and are not provided by this API.

## XLab example

The camera and external capture screens register an app-owned `XLabRemoteMediaFrames` receiver. Its Swift and Kotlin callbacks count delivered video frames and audio packets without retaining media buffers. Open the statistics panel to read these cumulative counters; JavaScript reads only scalar snapshots once per second while the panel is visible.

The screen unregisters the listener before releasing its native receiver. Background suspension stops SDK frame delivery, and foreground preview recovery retains the screen's registration for the next generation. Image input does not register this example receiver.
