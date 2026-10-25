package ai.xmax.xlab

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import ai.xmax.reactnative.RealtimeMediaFrameConsumer
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.facebook.react.uimanager.ViewManager

/** Retains a native MP4 recorder and its SDK frame consumer. */
private class XLabRemoteMediaFrameReceiver(context: ReactApplicationContext) {
  val recorder = RealtimeVideoRecorder(context)
  val consumer = RealtimeMediaFrameConsumer { frame -> recorder.append(frame) }

  fun close() {
    consumer.close()
    recorder.close()
  }
}

/** Exposes recording controls and completion status while keeping media bytes native. */
private class XLabRemoteMediaFrames(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val receivers = mutableMapOf<String, XLabRemoteMediaFrameReceiver>()
  private var invalidated = false

  override fun getName() = "XLabRemoteMediaFrames"

  @ReactMethod
  fun createConsumer(promise: Promise) {
    val receiver = synchronized(receivers) {
      if (invalidated) null
      else XLabRemoteMediaFrameReceiver(context).also { receivers[it.consumer.nativeHandle] = it }
    }
    if (receiver == null) promise.reject("MEDIA_ERROR", "record.failed")
    else promise.resolve(receiver.consumer.nativeHandle)
  }

  @ReactMethod
  fun startRecording(handle: String, promise: Promise) {
    val start = {
      val receiver = synchronized(receivers) { receivers[handle] }
      if (receiver == null) promise.reject("MEDIA_ERROR", "record.notRecording")
      else receiver.recorder.start { error ->
        if (error != null) promise.reject("MEDIA_ERROR", error) else promise.resolve(null)
      }
    }
    if (Build.VERSION.SDK_INT >= 29 || context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
      start()
    } else UiThreadUtil.runOnUiThread {
      val activity = context.currentActivity as? PermissionAwareActivity
      if (activity == null) promise.reject("MEDIA_ERROR", "record.permission")
      else activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 8403,
        PermissionListener { request, _, grants ->
          if (request != 8403) false
          else {
            if (grants.firstOrNull() == PackageManager.PERMISSION_GRANTED) start()
            else promise.reject("MEDIA_ERROR", "record.permission")
            true
          }
        })
    }
  }

  @ReactMethod
  fun stopRecording(handle: String, promise: Promise) {
    val receiver = synchronized(receivers) { receivers[handle] }
    if (receiver == null) promise.reject("MEDIA_ERROR", "record.notRecording")
    else receiver.recorder.stopAndSave { uri, error ->
      if (error != null) promise.reject("MEDIA_ERROR", error) else promise.resolve(uri)
    }
  }

  @ReactMethod
  fun getRecordingError(handle: String, promise: Promise) {
    promise.resolve(synchronized(receivers) { receivers[handle]?.recorder?.error() })
  }

  @ReactMethod
  fun releaseConsumer(handle: String, promise: Promise) {
    synchronized(receivers) { receivers.remove(handle) }?.close()
    promise.resolve(null)
  }

  override fun invalidate() {
    val previous = synchronized(receivers) {
      invalidated = true
      receivers.values.toList().also { receivers.clear() }
    }
    previous.forEach { it.close() }
    super.invalidate()
  }
}

/** Installs XLab's app-owned recording consumer. */
class XLabRemoteMediaFramesPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(XLabRemoteMediaFrames(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
