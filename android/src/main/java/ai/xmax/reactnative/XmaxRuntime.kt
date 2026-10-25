//
//  XmaxRuntime.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative
import com.facebook.react.uimanager.UIManagerHelper
import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.common.LifecycleState
import org.json.JSONObject
import java.util.UUID
import java.io.File
import java.util.concurrent.Executors

/**
 * A React Native TurboModule providing exclusive media leases and asynchronous native operations.
 *
 * @constructor Creates runtime services and registers Activity lifecycle listeners.
 * @param context The application or React context used to access native services and resource
 *   directories.
 */
@ReactModule(name = XmaxRuntime.NAME)
class XmaxRuntime(

  /**
   * The application or React context used for native services and cache directories.
   */
  private val context: ReactApplicationContext
) : NativeXmaxRuntimeSpec(context), Application.ActivityLifecycleCallbacks {

  /**
   * Declares the React Native module identifier.
   */
  companion object {

    /**
     * The module name used for TurboModule registration and lookup.
     */
    const val NAME = "XmaxRuntime"
  }

  /**
   * The Application used to determine foreground media eligibility from the Activity lifecycle.
   */
  private val app = context.applicationContext as Application

  /**
   * The serial file commit executor independent of the realtime media lifecycle.
   */
  private val files = Executors.newSingleThreadExecutor()

  /**
   * The service for native image metadata, conversion, and copy ownership.
   */
  private val images = XmaxImageManager(context)

  /**
   * The native image frame source, which must stop before RTC engine destruction.
   */
  private val imageVideo = XmaxImageVideoSource(
    this,
    File(
      context.cacheDir,
      "xmax-images"
    )
  )

  /**
   * The main-thread Handler used for view registration and RTC operations.
   */
  private val main = Handler(Looper.getMainLooper())

  /**
   * The number of started Activities; media acquisition is prohibited when it is 0.
   */
  @Volatile private var started = if (context.lifecycleState == LifecycleState.RESUMED) 1 else 0

  /**
   * The exclusive resource identifier; stale identifiers cannot release replacement resources.
   */
  private var owner: String? = null

  /**
   * Whether the current media lease still accepts native operations.
   */
  private var active = false

  /**
   * The RTC adapter operating under the current media lease.
   */
  private var rtc: XmaxAgoraEngine? = null

  /**
   * The weak video container references indexed by mount identifier.
   */
  private val surfaces = mutableMapOf<String, java.lang.ref.WeakReference<android.view.ViewGroup>>()

  /**
   * Initializes the resource manager and registers the lifecycle or rendering services required by
   * this instance.
   */
  init {
    app.registerActivityLifecycleCallbacks(this)
  }

  /**
   * Returns the module name used by React Native to locate the SDK.
   */
  override fun getName() = NAME

  /**
   * Applies global log filtering to the native runtime and worker queues.
   *
   * @param options The SDK log-category bitmask; 0 disables logging.
   */
  override fun configureLogging(
    options: Double
  ) {
    XmaxNativeLogger.configure(options.toInt())
  }

  /**
   * Writes a formatted SDK log entry with the specified level and category.
   *
   * @param level The log level: debug, info, warn, or error.
   * @param message The formatted log message.
   * @param option The current message's log-category bitmask.
   */
  override fun writeLog(
    level: String,
    message: String,
    option: Double
  ) {
    XmaxNativeLogger.write(
      level,
      message,
      option.toInt()
    )
  }

  /**
   * Hides the validated result container before cleaning up the room or canvas.
   *
   * Completes after the validated result container is hidden or confirmed unmounted; failures
   * reject the Promise with an SDK error code.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun hideVideoContainer(
    reactTag: Double,
    nativeID: String,
    promise: Promise
  ) {
    main.post {
      try {
        val tag = reactTag.toInt()
        val view = UIManagerHelper.getUIManager(
          context,
          tag
        )?.resolveView(tag)
        if (view?.getTag(com.facebook.react.R.id.view_tag_native_id) == nativeID) {
          // Keeps native visibility consistent with React opacity so a reused container does not remain hidden.
          view.alpha = 0f
        }

        promise.resolve(null)
      } catch (_: com.facebook.react.uimanager.IllegalViewOperationException) {
        // The unmounted container no longer obscures the local preview.

        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject(
          "INTERNAL_ERROR",
          "Unable to hide video container",
          error
        )
      }
    }
  }

  /**
   * Resolves the host on the UI thread, ignoring unmounted or reused React tags.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   * @param command The serialized trajectory drawing command.
   */
  override fun renderTrajectory(
    reactTag: Double,
    nativeID: String,
    command: String
  ) {
    main.post {
      try {
        val tag = reactTag.toInt()
        val host = UIManagerHelper.getUIManager(
          context,
          tag
        )?.resolveView(tag)
        if (host is android.view.ViewGroup &&
          host.getTag(com.facebook.react.R.id.view_tag_native_id) == nativeID) {
          XmaxTrajectoryView.renderIn(
            host,
            command
          )
        }
      } catch (_: com.facebook.react.uimanager.IllegalViewOperationException) {
        // A container may be unmounted after a touch command is queued.
      }
    }
  }

  /**
   * Refreshes the foreground state before requesting a native media lease.
   *
   * Completes after the foreground state refresh; failures reject the Promise with an SDK error
   * code.
   *
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun prepareRuntime(
    promise: Promise
  ) {

    promise.resolve(null)
  }

  /**
   * Acquires an exclusive foreground media lease if the runtime is valid and no other owner holds
   * it.
   *
   * @param token The media ownership identifier; only the current valid owner may modify resources.
   * @return Whether the exclusive foreground media lease was acquired.
   */
  @Synchronized override fun acquire(
    token: String
  ): Boolean {
    if (owner != null || started == 0) return false
    owner = token
    active = true
    return true
  }

  /**
   * Checks whether the specified identifier still owns valid media resources.
   *
   * @param token The media ownership identifier; only the current valid owner may modify resources.
   */
  @Synchronized override fun isActive(
    token: String
  ): Boolean = owner == token && active

  /**
   * Releases only the matching media lease after capture and engine cleanup.
   *
   * @param token The media ownership identifier; only the current valid owner may modify resources.
   */
  @Synchronized override fun release(
    token: String
  ) {
    if (owner == token) {
      imageVideo.stop()
      active = false
      owner = null
    }
  }

  /**
   * Validates media ownership before executing a decoded RTC command on the UI thread.
   *
   * Resolves the Promise with the native RTC operation's JSON result; rejects failures with an SDK
   * error code.
   *
   * @param token The media ownership identifier; only the current valid owner may modify resources.
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun rtcCommand(
    token: String,
    request: String,
    promise: Promise
  ) {
    main.post {
      synchronized(this) {
        try {
          check(isActive(token)) {
            "Media lease is unavailable"
          }
          val command = JSONObject(request)
          when (command.getString("operation")) {
            "open" -> {
              check(rtc == null) {
                "RTC engine is already open"
              }
              rtc = XmaxAgoraEngine(
                context,
                token
              ) {
                emitOnRtcEvent(it)
              }
              for ((id, view) in surfaces) view.get()?.let { rtc?.register(
                  id,
                  it
                )
              }
              promise.resolve("null")
            }
            "startImage" -> {
              val engine = requireNotNull(rtc).engine
              imageVideo.start(
                engine,
                command.getString("path"),
                command.getInt("width"),
                command.getInt("height"),
                command.getInt("fps"),
                { isActive(token) },
                promise
              )
            }
            else -> {
              if (command.getString("operation") in listOf(
                  "pause",
                  "close"
              )) imageVideo.stop()
              promise.resolve(requireNotNull(rtc).execute(command))
              if (command.getString("operation") == "close") rtc = null
            }
          }
        } catch (error: Exception) {
          promise.reject(
            "RTC_ERROR",
            "RTC operation failed",
            error
          )
        }
      }
    }
  }

  /**
   * Registers an existing video container after validating its native mount identifier.
   *
   * Completes after mount validation and registration; failures reject the Promise with an SDK
   * error code.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun registerVideoSurface(
    reactTag: Double,
    nativeID: String,
    promise: Promise
  ) {
    main.post {
      try {
        val tag = reactTag.toInt()
        val view = UIManagerHelper.getUIManager(
          context,
          tag
        )?.resolveView(tag)
        check(view is android.view.ViewGroup && view.getTag(com.facebook.react.R.id.view_tag_native_id) == nativeID) {
          "RTC canvas is no longer mounted"
        }
        surfaces[nativeID] = java.lang.ref.WeakReference(view)
        rtc?.register(
          nativeID,
          view
        )

        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject(
          "MEDIA_ERROR",
          "Unable to register RTC canvas",
          error
        )
      }
    }
  }

  /**
   * Removes only the specified video container's native registration.
   *
   * @param nativeID The native mount identity excluding removed or recycled views.
   */
  override fun unregisterVideoSurface(
    nativeID: String
  ) {
    main.post {
      surfaces.remove(nativeID)
      rtc?.unregister(nativeID)
    }
  }

  /**
   * Generates a unique identifier for a media owner, task, or image copy.
   */
  override fun randomUUID() = UUID.randomUUID().toString()

  /**
   * Serializes the runtime platform, operating system version, and device model.
   */
  override fun runtimeInfo() = JSONObject().put(
    "platform",
    "android"
  ).put(
    "os_version",
    Build.VERSION.RELEASE
  ).put(
    "device_model",
    Build.MODEL
  ).toString()

  /**
   * Checks media authorization requested through the React Native permission client.
   *
   * @param permission The camera or microphone permission to check.
   * @param promise The callback receiving whether the permission is granted.
   */
  override fun requestMediaPermission(
    permission: String,
    promise: Promise
  ) {
    val name = when (permission) {
      "camera" -> android.Manifest.permission.CAMERA
      "microphone" -> android.Manifest.permission.RECORD_AUDIO
      else -> {
        promise.reject(
          "INVALID_CONFIGURATION",
          "Invalid media permission"
        )
        return
      }
    }
    promise.resolve(
      androidx.core.content.ContextCompat.checkSelfPermission(
        reactApplicationContext,
        name
      ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    )
  }

  /**
   * Replaces a completed download's destination file on the file queue independently of the
   * realtime media lease.
   *
   * Completes after atomic destination replacement; failures reject the Promise with an SDK error
   * code.
   *
   * @param sourcePath The absolute path of the completed temporary file.
   * @param destinationPath The absolute destination path in the temporary file's directory.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun replaceFile(
    sourcePath: String,
    destinationPath: String,
    promise: Promise
  ) {
    try {
      files.execute {
        try {
          XmaxFileCommit.replace(
            sourcePath,
            destinationPath
          )

          promise.resolve(null)
        } catch (error: Exception) {
          promise.reject(
            "DOWNLOAD_ERROR",
            "Unable to commit downloaded file",
            error
          )
        }
      }
    } catch (error: java.util.concurrent.RejectedExecutionException) {
      promise.reject(
        "DOWNLOAD_ERROR",
        "Storage runtime is unavailable",
        error
      )
    }
  }

  /**
   * Reads orientation-corrected local image dimensions without transferring pixels across the
   * bridge.
   *
   * Resolves the Promise with JSON containing upright dimensions; rejects failures with an SDK
   * error code.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun imageInfo(
    fileURL: String,
    promise: Promise
  ) = images.info(
    fileURL,
    promise
  )

  /**
   * Reads local video display dimensions on the file queue without starting playback or capture.
   *
   * @param fileURL The readable local video file URL.
   * @param promise The callback receiving serialized dimensions or a media metadata error.
   */
  override fun videoInfo(
    fileURL: String,
    promise: Promise
  ) {
    files.execute {
      var reader: android.media.MediaMetadataRetriever? = null
      try {
        val metadata = android.media.MediaMetadataRetriever()
        reader = metadata
        val url = android.net.Uri.parse(fileURL)
        require(url.scheme == "file")
        metadata.setDataSource(
          context,
          url
        )
        val width = metadata.extractMetadata(
          android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH
        )?.toIntOrNull() ?: 0
        val height = metadata.extractMetadata(
          android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT
        )?.toIntOrNull() ?: 0
        val rotation = metadata.extractMetadata(
          android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION
        )?.toIntOrNull() ?: 0
        require(width > 0 && height > 0)
        val rotated = rotation == 90 || rotation == 270
        promise.resolve(
          JSONObject().put(
            "width",
            if (rotated) height else width
          ).put(
            "height",
            if (rotated) width else height
          ).toString()
        )
      } catch (error: Exception) {
        promise.reject(
          "MEDIA_ERROR",
          "Unable to read video metadata"
        )
      } finally {
        try { reader?.release() } catch (_: Exception) { }
      }
    }
  }

  /**
   * Creates a private upright JPEG copy at the target dimensions without modifying the caller's
   * original file.
   *
   * Resolves the Promise with the private JPEG URL; rejects failures with an SDK error code.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun prepareImage(
    fileURL: String,
    width: Double,
    height: Double,
    promise: Promise
  ) = images.prepare(
    fileURL,
    width,
    height,
    promise
  )

  /**
   * Deletes only SDK-owned image copies; an already absent copy is treated as successfully removed.
   *
   * Completes after copy cleanup; failures reject the Promise with an SDK error code.
   *
   * @param fileURL The SDK-owned private image copy URL returned by image preparation.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  override fun removePreparedImage(
    fileURL: String,
    promise: Promise
  ) = images.remove(
    fileURL,
    promise
  )

  /**
   * Updates the foreground Activity count for subsequent media acquisition checks.
   *
   * @param activity The Activity reporting the lifecycle notification.
   */
  @Synchronized override fun onActivityStarted(
    activity: Activity
  ) {
    started++
  }

  /**
   * Releases native media when the last started Activity stops.
   *
   * @param activity The Activity reporting the lifecycle notification.
   */
  @Synchronized override fun onActivityStopped(
    activity: Activity
  ) {
    started = maxOf(0, started - 1)
    if (started == 0 && active) {
      imageVideo.stop()
      active = false
      rtc?.close()
      rtc = null
    }
  }

  /**
   * Stops native work and releases current resources without cancelling caller-owned file or
   * transfer operations.
   */
  @Synchronized override fun invalidate() {
    app.unregisterActivityLifecycleCallbacks(this)
    imageVideo.invalidate()
    rtc?.close()
    rtc = null
    active = false
    owner = null
    images.invalidate()
    files.shutdown()
    super.invalidate()
  }

  /**
   * Receives Activity creation notifications; media eligibility remains based on the started
   * Activity count.
   *
   * @param activity The Activity reporting the lifecycle notification.
   * @param state The Activity state; SDK media ownership and credentials are not stored in it.
   */
  override fun onActivityCreated(
    activity: Activity,
    state: Bundle?
  ) {}

  /**
   * Receives Activity resume notifications without automatically restarting released media.
   *
   * @param activity The Activity reporting the lifecycle notification.
   */
  override fun onActivityResumed(
    activity: Activity
  ) {}

  /**
   * Receives Activity pause notifications; media release occurs when the Activity stops.
   *
   * @param activity The Activity reporting the lifecycle notification.
   */
  override fun onActivityPaused(
    activity: Activity
  ) {}

  /**
   * Receives Activity state save notifications without writing credentials or media resources to
   * the Bundle.
   *
   * @param activity The Activity reporting the lifecycle notification.
   * @param state The Activity state; SDK media ownership and credentials are not stored in it.
   */
  override fun onActivitySaveInstanceState(
    activity: Activity,
    state: Bundle
  ) {}

  /**
   * Receives Activity destruction notifications; runtime invalidation or background handling
   * releases native resources.
   *
   * @param activity The Activity reporting the lifecycle notification.
   */
  override fun onActivityDestroyed(
    activity: Activity
  ) {}
}
