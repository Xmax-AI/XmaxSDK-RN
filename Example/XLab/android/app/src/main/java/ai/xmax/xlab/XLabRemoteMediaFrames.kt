package ai.xmax.xlab

import ai.xmax.reactnative.RealtimeAudioFrame
import ai.xmax.reactnative.RealtimeMediaFrame
import ai.xmax.reactnative.RealtimeMediaFrameConsumer
import ai.xmax.reactnative.RealtimeVideoFrame
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

/** Counts delivered packets without retaining video planes or PCM buffers. */
private class XLabRemoteMediaFrameCounter {
  private var audioPackets = 0L
  private var videoFrames = 0L

  @Synchronized
  fun receive(frame: RealtimeMediaFrame) {
    when (frame.content) {
      is RealtimeAudioFrame -> audioPackets++
      is RealtimeVideoFrame -> videoFrames++
    }
  }

  /** Returns cumulative counts for this receiver's lifetime. */
  @Synchronized
  fun snapshot(): WritableMap = Arguments.createMap().apply {
    putDouble("audioPackets", audioPackets.toDouble())
    putDouble("videoFrames", videoFrames.toDouble())
  }
}

/** Retains the native receiver and consumes its packets on the SDK delivery queue. */
private class XLabRemoteMediaFrameReceiver {
  val counter = XLabRemoteMediaFrameCounter()
  val consumer = RealtimeMediaFrameConsumer { frame -> counter.receive(frame) }
}

/** Exposes receiver handles and scalar statistics; media bytes stay native. */
private class XLabRemoteMediaFrames(
  context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val receivers = mutableMapOf<String, XLabRemoteMediaFrameReceiver>()
  private var invalidated = false

  override fun getName() = "XLabRemoteMediaFrames"

  @ReactMethod
  fun createConsumer(promise: Promise) {
    val receiver = synchronized(receivers) {
      if (invalidated) null
      else XLabRemoteMediaFrameReceiver().also { receivers[it.consumer.nativeHandle] = it }
    }
    if (receiver == null) promise.reject("MEDIA_ERROR", "Remote media receivers are unavailable")
    else promise.resolve(receiver.consumer.nativeHandle)
  }

  @ReactMethod
  fun getStatistics(handle: String, promise: Promise) {
    val receiver = synchronized(receivers) { receivers[handle] }
    if (receiver == null) promise.reject("MEDIA_ERROR", "Remote media receiver is unavailable")
    else promise.resolve(receiver.counter.snapshot())
  }

  /** Releases only this handle after JavaScript has removed its SDK registration. */
  @ReactMethod
  fun releaseConsumer(handle: String, promise: Promise) {
    synchronized(receivers) { receivers.remove(handle) }?.consumer?.close()
    promise.resolve(null)
  }

  override fun invalidate() {
    val previous = synchronized(receivers) {
      invalidated = true
      receivers.values.toList().also { receivers.clear() }
    }
    previous.forEach { it.consumer.close() }
    super.invalidate()
  }
}

/** Installs XLab's app-owned remote frame consumer. */
class XLabRemoteMediaFramesPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(XLabRemoteMediaFrames(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
