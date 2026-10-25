//
//  XmaxAgoraEngine.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.content.Context
import android.view.ViewGroup
import io.agora.rtc2.*
import io.agora.rtc2.video.CameraCapturerConfiguration
import io.agora.rtc2.video.VideoCanvas
import io.agora.rtc2.video.VideoEncoderConfiguration
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * An adapter that executes native RTC commands and reports scalar events with resource ownership
 * identifiers. SDK services manage generation conditions and network policies.
 *
 * @constructor Creates an RTC engine and registers callbacks carrying resource ownership
 *   identifiers.
 * @param context The application or React context used to access native services and resource
 *   directories.
 * @param owner The owner identity; retired owners cannot modify replacement resources.
 * @param emit The callback that receives RTC events for the current media owner.
 */
internal class XmaxAgoraEngine(
  context: Context,

  /**
   * The exclusive resource identifier; stale identifiers cannot release replacement resources.
   */
  private val owner: String,

  /**
   * The current resource owner's callback for serialized RTC events.
   */
  private val emit: (String) -> Unit,
) {

  /**
   * The transport quality history indexed by model; does not store credentials.
   */
  private val preferences = context.getSharedPreferences(
    "xmax-sdk-quality",
    Context.MODE_PRIVATE
  )

  /**
   * The weak video container references indexed by mount identifier.
   */
  private val surfaces = mutableMapOf<String, WeakReference<ViewGroup>>()

  /**
   * The current RTC room identifier; empty when disconnected.
   */
  @Volatile private var roomID = ""

  /**
   * The ordered RTC data stream identifier; negative before creation.
   */
  @Volatile private var streamID = -1

  /**
   * Whether the native RTC adapter has stopped callbacks and released its engine.
   */
  @Volatile private var closed = false

  /**
   * Whether the encoder receives external frames instead of camera input.
   */
  private var external = false

  /** The current external receiver, invalidated before engine destruction. */
  private var externalSink: RealtimeExternalFrameSink? = null

  /**
   * Whether the front camera is selected.
   */
  private var front = true

  /**
   * The last accepted uplink encoding configuration, reapplied when camera settings change.
   */
  private var encoder: VideoEncoderConfiguration? = null

  /**
   * The last accepted camera capture format, used to restore preview if a configuration update
   * fails.
   */
  private var cameraConfiguration: CameraCapturerConfiguration? = null

  /**
   * The one-shot observer confirming decoded result readiness without a mounted video view.
   */
  private val remoteFrames = XmaxRemoteFrameObserver { uid, channel, token ->
    if (!closed && channel == roomID) event(
      "remoteFrameReady",
      "uid" to uid,
      "token" to token
    )
  }

  /** The optional pre-mix PCM observer retained while native media output is requested. */
  private var remoteAudioFrames: RtcRemoteAudioSink? = null

  /**
   * The native RTC engine held by the current media owner.
   */
  val engine: RtcEngine

  /**
   * Initializes the resource manager and registers the lifecycle or rendering services required by
   * this instance.
   */
  init {
    val config = RtcEngineConfig().apply {
      mContext = context.applicationContext
      mAppId = "5588dfe2e7874bd08ea28f4968ec2d40"
      mEventHandler =
        /**
         * Receives native RTC events for the current media owner.
         */
        object : IRtcEngineEventHandler() {

          /**
           * Creates an ordered message stream after joining and reports successful room entry.
           *
           * @param channel The RTC channel identifier reported by the join callback.
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onJoinChannelSuccess(
            channel: String,
            uid: Int,
            elapsed: Int
          ) {
            if (channel != roomID || closed) return
            externalSink?.setPublished(true)

            streamID = engine.createDataStream(
              DataStreamConfig().apply {
                ordered = true
                syncWithAudio = false
              }
            )
            if (streamID < 0) event(
              "error",
              "code" to streamID
            ) else event("joined")
          }

          /**
           * Reports successful local video publication for startup timing.
           *
           * @param source The local video source being published.
           * @param channel The channel containing the publication.
           * @param oldState The previous publication state.
           * @param newState The current publication state; 3 indicates successful publication.
           * @param elapseSinceLastState The transition interval, in milliseconds.
           */
          override fun onVideoPublishStateChanged(
            source: Constants.VideoSourceType?,
            channel: String?,
            oldState: Int,
            newState: Int,
            elapseSinceLastState: Int
          ) {
            if (!closed && channel == roomID && newState == 3) event("localPublished")
          }

          /**
           * Reports the string account associated with a remote numeric UID.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param info The RTC user information mapping a numeric UID to a string account.
           */
          override fun onUserInfoUpdated(
            uid: Int,
            info: UserInfo?
          ) {
            if (info != null) event(
              "account",
              "uid" to uid,
              "userID" to info.userAccount
            )
          }

          /**
           * Queries a remote user's string account after the user joins.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onUserJoined(
            uid: Int,
            elapsed: Int
          ) {
            val info = UserInfo()
            if (engine.getUserInfoByUid(
                uid,
                info
              ) == 0) {
              event(
                "account",
                "uid" to uid,
                "userID" to info.userAccount
              )
            }
          }

          /**
           * Resolves remote video publication state from native user status flags before
           * subscribing.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param state The native remote user status flags.
           */
          override fun onUserStateChanged(
            uid: Int,
            state: Int
          ) {
            val published = state and 2 == 0 && state and 16 != 0 && state and 256 != 0
            event(
              "publication",
              "uid" to uid,
              "published" to published
            )
          }

          /**
           * Reports that a remote user no longer publishes video after leaving.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param reason The native state transition reason code.
           */
          override fun onUserOffline(
            uid: Int,
            reason: Int
          ) {
            event(
              "publication",
              "uid" to uid,
              "published" to false
            )
          }

          /**
           * Reports whether remote video publication is muted.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param muted Whether the remote user has paused video publication.
           */
          override fun onUserMuteVideo(
            uid: Int,
            muted: Boolean
          ) {
            event(
              "publication",
              "uid" to uid,
              "published" to !muted
            )
          }

          /**
           * Reports publication state when a remote user enables or disables video.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param enabled Whether the remote user has enabled the specified video capability.
           */
          override fun onUserEnableVideo(
            uid: Int,
            enabled: Boolean
          ) {
            event(
              "publication",
              "uid" to uid,
              "published" to enabled
            )
          }

          /**
           * Reports whether a remote user has enabled local video capture.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param enabled Whether the remote user has enabled the specified video capability.
           */
          override fun onUserEnableLocalVideo(
            uid: Int,
            enabled: Boolean
          ) {
            event(
              "publication",
              "uid" to uid,
              "published" to enabled
            )
          }

          /**
           * Reports remote publication or its cessation from the received video state.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param state The native remote video state.
           * @param reason The native state transition reason code.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onRemoteVideoStateChanged(
            uid: Int,
            state: Int,
            reason: Int,
            elapsed: Int
          ) {
            if (state == 1 || state == 2) {
              event(
                "publication",
                "uid" to uid,
                "published" to true
              )
            } else if (reason == 5 || reason == 7) {
              event(
                "publication",
                "uid" to uid,
                "published" to false
              )
            }
          }

          // Native capture starts before JavaScript receives the track and mounts its preview.

          /**
           * Reports camera capture readiness or local video failure.
           *
           * @param source The native video source type for the frame or statistics.
           * @param state The native local video state.
           * @param error The native local video error code.
           */
          override fun onLocalVideoStateChanged(
            source: Constants.VideoSourceType?,
            state: Int,
            error: Int
          ) {
            if (state == 1) event("captureReady")
            else if (state == 3) event(
              "error",
              "code" to error
            )
          }

          /**
           * Reports that the first local preview frame has rendered.
           *
           * @param source The native video source type for the frame or statistics.
           * @param width The width, in pixels.
           * @param height The height, in pixels.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onFirstLocalVideoFrame(
            source: Constants.VideoSourceType?,
            width: Int,
            height: Int,
            elapsed: Int
          ) {
            event(
              "localFrame",
              "width" to width,
              "height" to height
            )
          }

          /**
           * Reports measured remote video dimensions when they change.
           *
           * @param source The native video source type for the frame or statistics.
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param width The width, in pixels.
           * @param height The height, in pixels.
           * @param rotation The clockwise frame rotation reported by RTC, in degrees.
           */
          override fun onVideoSizeChanged(
            source: Constants.VideoSourceType?,
            uid: Int,
            width: Int,
            height: Int,
            rotation: Int
          ) {
            if (uid != 0) event(
              "decoded",
              "uid" to uid,
              "width" to width,
              "height" to height
            )
          }

          /**
           * Reports measured dimensions of the first decoded remote result frame.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param width The width, in pixels.
           * @param height The height, in pixels.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onFirstRemoteVideoDecoded(
            uid: Int,
            width: Int,
            height: Int,
            elapsed: Int
          ) {
            event(
              "decoded",
              "uid" to uid,
              "width" to width,
              "height" to height
            )
          }

          /**
           * Reports that the first remote frame is displayed, allowing the result view to become
           * visible.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param width The width, in pixels.
           * @param height The height, in pixels.
           * @param elapsed The time elapsed since joining or preview startup, in milliseconds.
           */
          override fun onFirstRemoteVideoFrame(
            uid: Int,
            width: Int,
            height: Int,
            elapsed: Int
          ) {
            event(
              "rendered",
              "uid" to uid,
              "width" to width,
              "height" to height
            )
          }

          /**
           * Reports uplink and downlink network quality codes for the local user.
           *
           * @param uid The numeric RTC user identifier, mapped to a string account before
           *   notification.
           * @param txQuality The native uplink network quality code.
           * @param rxQuality The native downlink network quality code.
           */
          override fun onNetworkQuality(
            uid: Int,
            txQuality: Int,
            rxQuality: Int
          ) {
            if (uid == 0) event(
              "quality",
              "uplink" to txQuality,
              "downlink" to rxQuality
            )
          }

          /**
           * Reports scalar local video statistics for capture, encoding, sending, bitrate, packet
           * loss, and adaptation.
           *
           * @param source The native video source type for the frame or statistics.
           * @param stats The native video statistics.
           */
          override fun onLocalVideoStats(
            source: Constants.VideoSourceType?,
            stats: LocalVideoStats?
          ) {
            if (stats == null) return

            event(
              "uplinkStatistics",
              "width" to stats.encodedFrameWidth,
              "height" to stats.encodedFrameHeight,
              "captureFrameRate" to stats.captureFrameRate,
              "encodeFrameRate" to stats.encoderOutputFrameRate,
              "sendFrameRate" to stats.sentFrameRate,
              "bitrateKbps" to stats.sentBitrate,
              "packetLossPercent" to stats.txPacketLossRate,
              "adaptation" to stats.qualityAdaptIndication,
            )
          }

          /**
           * Reports scalar subscribed result statistics for dimensions, frame rates, bitrate,
           * packet loss, and latency.
           *
           * @param stats The native video statistics.
           */
          override fun onRemoteVideoStats(
            stats: RemoteVideoStats?
          ) {
            if (stats == null) return

            event(
              "downlinkStatistics",
              "uid" to stats.uid,
              "width" to stats.width,
              "height" to stats.height,
              "decodeFrameRate" to stats.decoderOutputFrameRate,
              "renderFrameRate" to stats.rendererOutputFrameRate,
              "bitrateKbps" to stats.receivedBitrate,
              "packetLossPercent" to stats.packetLossRate,
              "endToEndDelayMs" to stats.e2eDelay,
            )
          }

          /**
           * Reports a terminal native RTC connection error.
           *
           * @param state The native RTC connection state.
           * @param reason The native state transition reason code.
           */
          override fun onConnectionStateChanged(
            state: Int,
            reason: Int
          ) {
            if (state == 5) event(
              "error",
              "code" to reason
            )
          }

          /**
           * Reports token expiration as an error so the current RTC connection can be released.
           */
          override fun onRequestToken() {
            event(
              "error",
              "code" to "TOKEN_EXPIRED"
            )
          }

          /**
           * Reports a native RTC error using its numeric code.
           *
           * @param err The native RTC error code.
           */
          override fun onError(
            err: Int
          ) {
            event(
              "error",
              "code" to err
            )
          }
        }
    }
    engine = RtcEngine.create(config)

    try {
      check(engine.registerVideoFrameObserver(remoteFrames))
      check(engine.enableVideo())
      check(engine.enableLocalVideo(false))
      check(engine.enableLocalAudio(false))
    } catch (error: Throwable) {
      closed = true
      RtcEngine.destroy()
      throw error
    }
  }

  /**
   * Registers a weak reference to a validated video container.
   *
   * @param id The native mount identifier of the video container.
   * @param view The native video container whose mount identifier has been validated by the
   *   runtime.
   */
  fun register(
    id: String,
    view: ViewGroup
  ) {
    surfaces[id] = WeakReference(view)
  }

  /**
   * Removes a video container registration without retaining or modifying a replacement container.
   *
   * @param id The native mount identifier of the video container.
   */
  fun unregister(
    id: String
  ) {
    surfaces.remove(id)
  }

  /**
   * Executes an RTC command under the current resource lease and returns a serialized result.
   *
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   * @return The JSON result; operations without a result return the string null.
   */
  fun execute(
    request: JSONObject
  ): String {
    check(!closed)
    when (request.getString("operation")) {
      "readPreference" -> return preferences.getString(
        request.getString("key"),
        "null"
      ) ?: "null"
      "writePreference" -> preferences.edit()
        .putString(
        request.getString("key"),
        request.getString("value")
      ).apply()
      "encoding" -> configureEncoding(request)
      "camera" -> startCamera(request)
      "updateCameraFormat" -> updateCameraFormat(request)
      "switchCamera" -> {
        front = request.optBoolean(
          "front",
          true
        )
        check(engine.switchCamera())
        cameraConfiguration?.cameraDirection = if (front) CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_FRONT else CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_REAR
        applyMirror()
      }
      "image" -> {
        external = true
        engine.stopPreview()
        check(engine.enableLocalVideo(false))
        check(
          engine.setExternalVideoSource(
            true,
            false,
            Constants.ExternalVideoSourceType.VIDEO_FRAME
          )
        )
      }
      "external" -> {
        require(roomID.isEmpty())
        external = true
        front = false
        engine.stopPreview()
        check(engine.enableLocalVideo(false))
        check(engine.setExternalVideoSource(true, false, Constants.ExternalVideoSourceType.VIDEO_FRAME))
        check(engine.enableLocalVideo(true))
        check(engine.enableLocalAudio(false))
        externalSink?.invalidate()
        externalSink = RealtimeExternalFrameSink(request.getString("sinkID"), request.getInt("sourceWidth"),
          request.getInt("sourceHeight"), RealtimeExternalVideoFormat(request.getInt("width"), request.getInt("height"),
          request.getInt("fps")), request.optBoolean("hasAudio"), engine) {
          event("error", "code" to "MEDIA_ERROR", "scope" to "all")
        }
      }
      "join" -> join(request)
      "observeRemoteFrame" -> remoteFrames.observe(
        roomID,
        request.getInt("uid"),
        request.getString("token")
      )
      "remoteMediaFrames" -> {
        if (!request.isNull("nativeHandle")) {
          val consumer = RealtimeMediaFrameConsumer.find(request.getString("nativeHandle"))
            ?: error("Remote media frame consumer is unavailable")
          require(roomID.isNotEmpty())
          check(engine.setPlaybackAudioFrameBeforeMixingParameters(48000, 1, 480))
          val audio = RtcRemoteAudioSink(remoteFrames)
          check(engine.registerAudioFrameObserver(audio))
          remoteAudioFrames = audio
          remoteFrames.setOutput(consumer, roomID, request.getInt("uid"), request.getString("streamID"))
        } else {
          remoteFrames.setOutput(null)
          engine.registerAudioFrameObserver(null)
          remoteAudioFrames = null
        }
      }
      "clearRemoteFrame" -> remoteFrames.clear(request.optString("token"))
      "remoteAudio" -> check(
        engine.muteRemoteAudioStream(
          request.getInt("uid"),
          !request.optBoolean("enabled")
        )
      )
      "subscribe" -> {
        val uid = request.getInt("uid")
        check(
          engine.muteRemoteVideoStream(
            uid,
            false
          )
        )
      }
      "send" -> {
        require(streamID >= 0)
        val data = request.getString("message").toByteArray(Charsets.UTF_8)
        require(data.size <= 1024)
        check(
          engine.sendStreamMessage(
            streamID,
            data
          )
        )
      }
      "volume" -> check(engine.adjustPlaybackSignalVolume(request.getInt("volume")))
      "bind" -> bind(request)
      "unbind" -> {
        val uid = request.getInt("uid")
        val canvas = VideoCanvas(
          null,
          Constants.RENDER_MODE_HIDDEN,
          uid
        )
        if (uid == 0 && external) canvas.sourceType = Constants.VideoSourceType.VIDEO_SOURCE_CUSTOM.value
        check(if (uid == 0) engine.setupLocalVideo(canvas) else engine.setupRemoteVideo(canvas))
      }
      "pause" -> {
        externalSink?.invalidate()
        engine.stopPreview(Constants.VideoSourceType.VIDEO_SOURCE_CUSTOM)
        engine.stopPreview()
        engine.enableLocalVideo(false)
        engine.enableLocalAudio(false)
      }
      "leave" -> {
        remoteFrames.setOutput(null)
        engine.registerAudioFrameObserver(null)
        remoteAudioFrames = null
        externalSink?.setPublished(false)
        remoteFrames.clear()
        roomID = ""
        streamID = -1
        engine.enableLocalAudio(false)
        check(engine.leaveChannel())
      }
      "close" -> close()
      else -> error("Unknown RTC command")
    }
    return "null"
  }

  /**
   * Converts validated dimensions, frame rate, bitrate, and degradation preference into native
   * encoding settings.
   *
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   */
  private fun configureEncoding(
    request: JSONObject
  ) {
    val config = VideoEncoderConfiguration(
      VideoEncoderConfiguration.VideoDimensions(
        request.getInt("width"),
        request.getInt("height")
      ),
      VideoEncoderConfiguration.FRAME_RATE.FRAME_RATE_FPS_30,
      request.getInt("maximum"),
      VideoEncoderConfiguration.ORIENTATION_MODE.ORIENTATION_MODE_ADAPTIVE,
    )
    config.frameRate = request.getInt("fps")
    config.minBitrate = request.getInt("minimum")
    config.degradationPrefer = when (request.optString("preference")) {
      "auto" -> VideoEncoderConfiguration.DEGRADATION_PREFERENCE.MAINTAIN_BALANCED
      "maintainQuality" -> VideoEncoderConfiguration.DEGRADATION_PREFERENCE.MAINTAIN_QUALITY
      else -> VideoEncoderConfiguration.DEGRADATION_PREFERENCE.MAINTAIN_FRAMERATE
    }
    config.mirrorMode = if (!external && front) {
      VideoEncoderConfiguration.MIRROR_MODE_TYPE.MIRROR_MODE_ENABLED
    } else {
      VideoEncoderConfiguration.MIRROR_MODE_TYPE.MIRROR_MODE_DISABLED
    }
    check(engine.setVideoEncoderConfiguration(config))
    encoder = config
  }

  /**
   * Starts native camera capture with the specified position, dimensions, and frame rate.
   *
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   */
  private fun startCamera(
    request: JSONObject
  ) {
    external = false
    front = request.optBoolean(
      "front",
      true
    )
    val direction = if (front) CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_FRONT
    else CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_REAR
    val config = CameraCapturerConfiguration(direction)
    config.captureFormat = CameraCapturerConfiguration.CaptureFormat(
      request.getInt("width"),
      request.getInt("height"),
      request.getInt("fps"),
    )
    check(engine.setCameraCapturerConfiguration(config))
    cameraConfiguration = config
    applyMirror()
    check(engine.enableLocalVideo(true))
    check(engine.startPreview())
  }

  /**
   * Updates camera capture and encoding in place, restoring the previous format on failure. Reports
   * a media error if restoration also fails.
   *
   * @param request The validated target dimensions, frame rate, bitrate, and encoding preference.
   */
  private fun updateCameraFormat(
    request: JSONObject
  ) {
    require(!external && roomID.isEmpty())
    val previousCapture = requireNotNull(cameraConfiguration)
    val previousEncoder = requireNotNull(encoder)
    val direction = if (front) CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_FRONT
    else CameraCapturerConfiguration.CAMERA_DIRECTION.CAMERA_REAR
    val nextCapture = CameraCapturerConfiguration(direction)
    nextCapture.captureFormat = CameraCapturerConfiguration.CaptureFormat(
      request.getInt("width"),
      request.getInt("height"),
      request.getInt("fps"),
    )

    try {
      check(engine.setCameraCapturerConfiguration(nextCapture))
      configureEncoding(request)
      cameraConfiguration = nextCapture
    } catch (failure: Exception) {
      val captureResult = engine.setCameraCapturerConfiguration(previousCapture)
      val encodingResult = engine.setVideoEncoderConfiguration(previousEncoder)
      encoder = previousEncoder
      if (captureResult < 0 || encodingResult < 0) event(
        "error",
        "code" to -1,
        "scope" to "all"
      )
      throw failure
    }
  }

  /**
   * Joins the room with a string account and explicit publication and subscription options.
   *
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   */
  private fun join(
    request: JSONObject
  ) {
    roomID = request.getString("roomID")
    val options = ChannelMediaOptions().apply {
      channelProfile = Constants.CHANNEL_PROFILE_LIVE_BROADCASTING
      clientRoleType = Constants.CLIENT_ROLE_BROADCASTER
      publishCameraTrack = !external
      publishCustomVideoTrack = external
      publishMicrophoneTrack = request.optBoolean("microphone")
      publishCustomAudioTrack = externalSink?.audioTrackID != null
      externalSink?.audioTrackID?.let { publishCustomAudioTrackId = it }
      autoSubscribeAudio = false
      autoSubscribeVideo = false
    }
    check(engine.enableLocalAudio(request.optBoolean("microphone")))
    check(
      engine.joinChannelWithUserAccount(
        request.getString("token"),
        roomID,
        request.getString("userID"),
        options,
      )
    )
  }

  /**
   * Installs a canvas in a validated container using the local or remote stream and scaling mode.
   *
   * @param request The RTC operation and parameters decoded and validated from a JavaScript
   *   request.
   */
  private fun bind(
    request: JSONObject
  ) {
    val host = surfaces[request.getString("viewID")]?.get()
      ?: error("RTC canvas is no longer mounted")
    host.removeAllViews()
    val texture = XmaxVideoTextureView(host.context)
    host.addView(
      texture,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    )
    val uid = request.getInt("uid")
    val canvas = VideoCanvas(
      texture,
      if (request.optString("mode") == "fit") Constants.RENDER_MODE_FIT else Constants.RENDER_MODE_HIDDEN,
      uid,
    )
    if (uid == 0 && external) canvas.sourceType = Constants.VideoSourceType.VIDEO_SOURCE_CUSTOM.value
    canvas.mirrorMode = if (uid == 0 && !external && front) Constants.VIDEO_MIRROR_MODE_ENABLED
    else Constants.VIDEO_MIRROR_MODE_DISABLED
    check(if (uid == 0) engine.setupLocalVideo(canvas) else engine.setupRemoteVideo(canvas))
    if (uid == 0 && external) check(engine.startPreview(Constants.VideoSourceType.VIDEO_SOURCE_CUSTOM))
  }

  /**
   * Stops callbacks before destroying the current RTC engine; repeated closure is safe.
   */
  fun close() {
    if (closed) return
    externalSink?.invalidate()
    externalSink = null
    closed = true
    remoteFrames.close()
    engine.registerAudioFrameObserver(null)
    remoteAudioFrames = null
    engine.registerVideoFrameObserver(null)
    roomID = ""
    RtcEngine.destroy()
    surfaces.clear()
  }

  /**
   * Updates the cached encoder mirroring settings for the current camera position.
   */
  private fun applyMirror() {
    encoder?.let {
      it.mirrorMode = if (front) VideoEncoderConfiguration.MIRROR_MODE_TYPE.MIRROR_MODE_ENABLED
      else VideoEncoderConfiguration.MIRROR_MODE_TYPE.MIRROR_MODE_DISABLED
      check(engine.setVideoEncoderConfiguration(it))
    }
  }

  /**
   * Throws an SDK operation error when a native RTC call returns a negative result.
   *
   * @param result The native RTC result; negative values indicate failure.
   */
  private fun check(
    result: Int
  ) {
    require(result >= 0) {
      "Agora RTC operation failed ($result)"
    }
  }

  /**
   * Serializes safe RTC metadata with the media owner and room identifiers.
   *
   * @param type The normalized event type delivered to the JavaScript resource manager.
   * @param values The scalar metadata exposed for this RTC event.
   */
  private fun event(
    type: String,
    vararg values: Pair<String, Any?>
  ) {
    if (closed) return
    val payload = JSONObject().put(
      "owner",
      owner
    ).put(
      "roomID",
      roomID
    ).put(
      "type",
      type
    )
    for ((key, value) in values) payload.put(
      key,
      value
    )
    emit(payload.toString())
  }
}
