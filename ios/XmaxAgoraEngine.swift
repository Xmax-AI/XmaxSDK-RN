//
//  XmaxAgoraEngine.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import Foundation
import CoreMedia
@preconcurrency import AgoraRtcKit
@preconcurrency import UIKit

/// An adapter that executes native RTC commands and reports scalar events with resource ownership
/// identifiers. SDK services manage generation conditions and network policies.
final class XmaxAgoraEngine: NSObject, AgoraRtcEngineDelegate, @unchecked Sendable {

  /// The native RTC engine held by the current media owner.
  private(set) var engine: AgoraRtcEngineKit?

  /// The exclusive resource identifier; stale identifiers cannot release replacement resources.
  private var owner = ""

  /// The current RTC room identifier; empty when disconnected.
  private var roomID = ""

  /// The ordered RTC data stream identifier; negative before creation.
  private var streamID: Int = -1

  /// The one-shot observer confirming decoded result readiness without a video view.
  private var remoteFrames: XmaxRemoteFrameObserver?

  /// The pre-mix PCM observer enabled only for requested native output.
  private var remoteAudioFrames: RtcRemoteAudioSink?

  /// Whether the encoder receives external frames instead of camera input.
  private var external = false

  /// The native external receiver invalidated before engine release.
  private var externalSink: RealtimeExternalFrameSink?

  /// Whether the front camera is selected.
  private var front = true

  /// The last accepted uplink encoding configuration, reapplied when camera settings change.
  private var encoder: AgoraVideoEncoderConfiguration?

  /// The last accepted camera capture format, used to restore preview if an in-place update fails.
  private var cameraConfiguration: AgoraCameraCapturerConfiguration?

  /// The current resource owner's callback for serialized RTC events.
  private var emit: ((String) -> Void)?

  /// The weak video container references indexed by mount identifier.
  private var surfaces: [String: WeakView] = [:]

  /// Registers a weak reference to a validated video container.
  ///
  /// - Parameters:
  ///   - view: The native video container whose mount identifier has been validated by the runtime.
  ///   - id: The native mount identifier of the video container.
  @MainActor
  func register(
    _ view: UIView,
    id: String
  ) {
    surfaces[id] = WeakView(view)
  }

  /// Removes a video container registration without retaining or modifying a replacement container.
  ///
  /// - Parameter id: The native mount identifier of the video container.
  @MainActor
  func unregister(
    _ id: String
  ) {
    surfaces.removeValue(forKey: id)
  }

  /// Executes an RTC command under the current resource lease and returns a serialized result.
  ///
  /// - Parameters:
  ///   - owner: The owner identity; retired owners cannot modify replacement resources.
  ///   - request: The RTC operation and parameters decoded and validated from a JavaScript request.
  ///   - emit: The callback that receives RTC events for the current media owner.
  ///
  /// - Returns: The JSON result; operations without a result return the string null.
  ///
  /// - Throws: An operation error caused by invalid parameters or unavailable native resources.
  @MainActor
  func execute(
    owner: String,
    request: [String: Any],
    emit: @escaping (String) -> Void
  ) throws -> String {
    guard let operation = request["operation"] as? String else {
      throw XmaxNativeFailure(message: "Invalid RTC command")
    }
    if operation == "open" {
      self.owner = owner
      self.emit = emit
      let config = AgoraRtcEngineConfig()
      config.appId = "5588dfe2e7874bd08ea28f4968ec2d40"
      config.channelProfile = .liveBroadcasting
      engine = AgoraRtcEngineKit.sharedEngine(
        with: config,
        delegate: self
      )
      remoteFrames = XmaxRemoteFrameObserver { [weak self] uid, channel, token in
        Task { @MainActor [weak self] in
          guard let self, self.owner == owner, self.roomID == channel else { return }
          self.event(
            "remoteFrameReady",
            ["uid": uid, "token": token]
          )
        }
      }
      guard engine!.setVideoFrameDelegate(remoteFrames) else {
        throw XmaxNativeFailure(message: "Remote frame observation is unavailable")
      }
      try check(engine!.enableVideo())
      try check(engine!.enableLocalAudio(false))
      try check(engine!.enableLocalVideo(false))
      return "null"
    }
    guard owner == self.owner, let engine else {
      throw XmaxNativeFailure(message: "RTC engine is unavailable")
    }
    switch operation {
    case "readPreference":
      return UserDefaults.standard.string(forKey: "ai.xmax." + (request["key"] as? String ?? ""))
        ?? "null"
    case "writePreference":
      UserDefaults.standard.set(
        request["value"] as? String,
        forKey: "ai.xmax." + (request["key"] as? String ?? "")
      )
    case "encoding":
      try configureEncoding(request)
    case "updateCameraFormat":
      try updateCameraFormat(request)
    case "camera":
      external = false
      front = request["front"] as? Bool ?? true
      let config = AgoraCameraCapturerConfiguration()
      config.cameraDirection = front ? .front : .rear
      config.dimensions = CGSize(
        width: int(
          request,
          "width"
        ),
        height: int(
          request,
          "height"
        )
      )
      config.followEncodeDimensionRatio = true
      config.frameRate = Int32(
        int(
          request,
          "fps"
        )
      )
      try check(engine.setCameraCapturerConfiguration(config))
      cameraConfiguration = config
      encoder?.orientationMode = cameraOrientation(config.dimensions)
      encoder?.mirrorMode = front ? .enabled : .disabled
      if let encoder { try check(engine.setVideoEncoderConfiguration(encoder)) }
      try check(engine.enableLocalVideo(true))
      try check(engine.startPreview())
    case "switchCamera":
      front = request["front"] as? Bool ?? true
      try check(engine.switchCamera())
      cameraConfiguration?.cameraDirection = front ? .front : .rear
      encoder?.mirrorMode = front ? .enabled : .disabled
      if let encoder { try check(engine.setVideoEncoderConfiguration(encoder)) }
    case "image":
      external = true
      _ = engine.stopPreview()
      try check(engine.enableLocalVideo(false))
      engine.setExternalVideoSource(
        true,
        useTexture: false,
        sourceType: .videoFrame
      )
    case "external":
      guard roomID.isEmpty else {
        throw XmaxNativeFailure(message: "Disconnect before external input")
      }
      external = true
      front = false
      _ = engine.stopPreview()
      try check(engine.enableLocalVideo(false))
      engine.setExternalVideoSource(true, useTexture: false, sourceType: .videoFrame)
      try check(engine.enableLocalAudio(false))
      externalSink?.invalidate()
      externalSink = try RealtimeExternalFrameSink(request: request, engine: engine) {
        [weak self] in
        Task { @MainActor in self?.event("error", ["code": "MEDIA_ERROR", "scope": "all"]) }
      }
      try check(engine.startPreview(.custom))
    case "join":
      roomID = request["roomID"] as? String ?? ""
      let options = AgoraRtcChannelMediaOptions()
      options.channelProfile = .liveBroadcasting
      options.clientRoleType = .broadcaster
      options.publishCameraTrack = !external
      options.publishCustomVideoTrack = external
      options.publishMicrophoneTrack = request["microphone"] as? Bool ?? false
      options.publishCustomAudioTrack = externalSink?.audioTrackID != nil
      if let id = externalSink?.audioTrackID { options.publishCustomAudioTrackId = id }
      options.autoSubscribeVideo = false
      options.autoSubscribeAudio = false
      try check(engine.enableLocalAudio(options.publishMicrophoneTrack))
      try check(
        engine.joinChannel(
          byToken: request["token"] as? String,
          channelId: roomID,
          userAccount: request["userID"] as? String ?? "",
          mediaOptions: options
        )
      )
    case "observeRemoteFrame":
      remoteFrames?.observe(
        roomID: roomID,
        uid: UInt(int(request, "uid")),
        token: request["token"] as? String ?? ""
      )
    case "remoteMediaFrames":
      if let handle = request["nativeHandle"] as? String {
        guard let consumer = RealtimeMediaFrameConsumer.find(handle),
          let identity = request["streamID"] as? String, let stream = UUID(uuidString: identity),
          !roomID.isEmpty, let remoteFrames
        else { throw XmaxNativeFailure(message: "Remote media frame consumer is unavailable") }
        try check(
          engine.setPlaybackAudioFrameBeforeMixingParametersWithSampleRate(
            48000,
            channel: 1,
            samplesPerCall: 480
          )
        )
        let audio = RtcRemoteAudioSink { [weak remoteFrames] uid, channel in
          remoteFrames?.audioListener(
            uid: uid,
            roomID: channel
          )
        }
        guard engine.setAudioFrameDelegate(audio) else {
          throw XmaxNativeFailure(message: "Remote audio frame observation is unavailable")
        }
        remoteAudioFrames = audio
        remoteFrames.setOutput(
          consumer: consumer,
          roomID: roomID,
          uid: UInt(int(request, "uid")),
          streamID: stream
        )
      } else {
        remoteFrames?.setOutput(consumer: nil)
        engine.setAudioFrameDelegate(nil)
        remoteAudioFrames = nil
      }
    case "clearRemoteFrame":
      remoteFrames?.clear(token: request["token"] as? String)
    case "remoteAudio":
      try check(
        engine.muteRemoteAudioStream(
          UInt(int(request, "uid")),
          mute: !(request["enabled"] as? Bool ?? false)
        )
      )
    case "subscribe":
      let uid = UInt(
        int(
          request,
          "uid"
        )
      )
      try check(
        engine.muteRemoteVideoStream(
          uid,
          mute: false
        )
      )
    case "send":
      guard streamID >= 0 else {
        throw XmaxNativeFailure(message: "RTC data stream is unavailable")
      }
      let message = request["message"] as? String ?? ""
      guard let data = message.data(using: .utf8), data.count <= 1024 else {
        throw XmaxNativeFailure(message: "Invalid RTC data packet")
      }
      try check(
        engine.sendStreamMessage(
          streamID,
          data: data
        )
      )
    case "volume":
      try check(
        engine.adjustPlaybackSignalVolume(
          int(
            request,
            "volume"
          )
        )
      )
    case "bind":
      guard let id = request["viewID"] as? String, let view = surfaces[id]?.value else {
        throw XmaxNativeFailure(message: "RTC canvas is no longer mounted")
      }
      let canvas = AgoraRtcVideoCanvas()
      canvas.view = view
      canvas.uid = UInt(
        int(
          request,
          "uid"
        )
      )
      canvas.renderMode = request["mode"] as? String == "fit" ? .fit : .hidden
      if canvas.uid == 0 && external { canvas.sourceType = .custom }
      canvas.mirrorMode = canvas.uid == 0 && !external && front ? .enabled : .disabled
      try check(canvas.uid == 0 ? engine.setupLocalVideo(canvas) : engine.setupRemoteVideo(canvas))
    case "unbind":
      let canvas = AgoraRtcVideoCanvas()
      canvas.uid = UInt(
        int(
          request,
          "uid"
        )
      )
      try check(canvas.uid == 0 ? engine.setupLocalVideo(canvas) : engine.setupRemoteVideo(canvas))
    case "pause":
      externalSink?.invalidate()
      _ = engine.stopPreview(.custom)
      _ = engine.stopPreview()
      _ = engine.enableLocalVideo(false)
      _ = engine.enableLocalAudio(false)
    case "leave":
      remoteFrames?.setOutput(consumer: nil)
      engine.setAudioFrameDelegate(nil)
      remoteAudioFrames = nil
      externalSink?.setPublished(false)
      remoteFrames?.clear()
      roomID = ""
      streamID = -1
      _ = engine.enableLocalAudio(false)
      try check(engine.leaveChannel(nil))
    case "close":
      close()
    default: throw XmaxNativeFailure(message: "Unknown RTC command")
    }
    return "null"
  }

  /// Applies the native encoding format and caches restoration values only after configuration
  /// succeeds.
  ///
  /// - Parameter request: The validated dimensions, frame rate, bitrate, and encoding preference.
  @MainActor
  private func configureEncoding(
    _ request: [String: Any]
  ) throws {
    let dimensions = CGSize(
      width: int(
        request,
        "width"
      ),
      height: int(
        request,
        "height"
      )
    )
    let config = AgoraVideoEncoderConfiguration(
      size: dimensions,
      frameRate: int(
        request,
        "fps"
      ),
      bitrate: int(
        request,
        "maximum"
      ),
      orientationMode: !external && cameraConfiguration != nil
        ? cameraOrientation(dimensions) : .adaptative,
      mirrorMode: external || !front ? .disabled : .enabled
    )
    config.minBitrate = int(
      request,
      "minimum"
    )
    config.degradationPreference =
      request["preference"] as? String == "maintainQuality"
      ? .maintainQuality
      : request["preference"] as? String == "auto" ? .balanced : .maintainFramerate
    try check(engine!.setVideoEncoderConfiguration(config))
    encoder = config
  }

  /// Selects a fixed output direction matching the camera format's dimensions.
  ///
  /// - Parameter size: The camera frame dimensions, in pixels.
  /// - Returns: Landscape for square or wide frames, and portrait for tall frames.
  private func cameraOrientation(
    _ size: CGSize
  ) -> AgoraVideoOutputOrientationMode {
    size.width >= size.height ? .fixedLandscape : .fixedPortrait
  }

  /// Pauses disconnected capture to apply new dimensions, retaining the canvas and restoring
  /// capture and encoding on failure.
  ///
  /// - Parameter request: The validated target camera format and encoding parameters.
  ///
  /// - Throws: An error for invalid state or failed capture or encoding configuration. Reports a
  ///   media error if restoration also fails.
  @MainActor
  private func updateCameraFormat(
    _ request: [String: Any]
  ) throws {
    guard !external, roomID.isEmpty, let engine,
      let previousCapture = cameraConfiguration, let previousEncoder = encoder
    else {
      throw XmaxNativeFailure(message: "Camera preview is unavailable")
    }
    let nextCapture = AgoraCameraCapturerConfiguration()
    nextCapture.cameraDirection = front ? .front : .rear
    nextCapture.dimensions = CGSize(
      width: int(
        request,
        "width"
      ),
      height: int(
        request,
        "height"
      )
    )
    nextCapture.frameRate = Int32(
      int(
        request,
        "fps"
      )
    )
    nextCapture.followEncodeDimensionRatio = true

    do {
      try check(engine.stopPreview())
      try check(engine.enableLocalVideo(false))
      try check(engine.setCameraCapturerConfiguration(nextCapture))
      try configureEncoding(request)
      try check(engine.enableLocalVideo(true))
      try check(engine.startPreview())
      cameraConfiguration = nextCapture
    } catch {
      let restorationResults = [
        engine.stopPreview(),
        engine.enableLocalVideo(false),
        engine.setCameraCapturerConfiguration(previousCapture),
        engine.setVideoEncoderConfiguration(previousEncoder),
        engine.enableLocalVideo(true),
        engine.startPreview(),
      ]
      encoder = previousEncoder
      if restorationResults.contains(where: { $0 < 0 }) {
        event(
          "error",
          ["code": -1, "scope": "all"]
        )
      }
      throw error
    }
  }

  /// Stops callbacks before destroying the current RTC engine; repeated closure is safe.
  func close() {
    guard engine != nil else { return }
    externalSink?.invalidate()
    externalSink = nil
    remoteFrames?.setOutput(consumer: nil)
    engine?.setAudioFrameDelegate(nil)
    remoteAudioFrames = nil
    remoteFrames?.clear()
    engine?.setVideoFrameDelegate(nil)
    remoteFrames = nil
    emit = nil
    owner = ""
    roomID = ""
    streamID = -1
    engine = nil
    encoder = nil
    cameraConfiguration = nil
    surfaces.removeAll()
    AgoraRtcEngineKit.destroy()
  }

  /// Reads an integer request parameter, returning 0 when no value is present.
  ///
  /// - Parameters:
  ///   - value: The RTC parameters decoded from the bridge request.
  ///   - key: The key of the numeric parameter to read.
  private func int(
    _ value: [String: Any],
    _ key: String
  ) -> Int {
    (value[key] as? NSNumber)?.intValue ?? 0
  }

  /// Throws an SDK operation error when a native RTC call returns a negative result.
  ///
  /// - Parameter result: The native RTC result; negative values indicate failure.
  ///
  /// - Throws: An operation error caused by invalid parameters or unavailable native resources.
  private func check(
    _ result: Int32
  ) throws {
    if result < 0 { throw XmaxNativeFailure(message: "Agora RTC operation failed (\(result))") }
  }

  /// Serializes safe RTC metadata with the media owner and room identifiers.
  ///
  /// - Parameters:
  ///   - type: The normalized event type delivered to the JavaScript resource manager.
  ///   - fields: The scalar metadata exposed for this RTC event.
  private func event(
    _ type: String,
    _ fields: [String: Any] = [:]
  ) {
    var value = fields
    value["type"] = type
    value["owner"] = owner
    value["roomID"] = roomID
    if let data = try? JSONSerialization.data(withJSONObject: value),
      let message = String(
        data: data,
        encoding: .utf8
      )
    {
      emit?(message)
    }
  }

  /// Creates an ordered message stream after joining and reports successful room entry.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - channel: The RTC channel identifier reported by the join callback.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didJoinChannel channel: String,
    withUid uid: UInt,
    elapsed: Int
  ) {
    guard channel == roomID, self.engine != nil else { return }
    let config = AgoraDataStreamConfig()
    config.ordered = true
    config.syncWithAudio = false
    let result = engine.createDataStream(
      &streamID,
      config: config
    )
    if result < 0 {
      event(
        "error",
        ["code": result]
      )
      return
    }
    externalSink?.setPublished(true)
    event("joined")
  }

  /// Reports successful local video publication for startup timing.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine reporting the publication change.
  ///   - channelId: The channel containing the local publication.
  ///   - sourceType: The local video source being published.
  ///   - oldState: The previous publication state.
  ///   - newState: The current publication state.
  ///   - elapseSinceLastState: The state transition interval, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didVideoPublishStateChange channelId: String,
    sourceType: AgoraVideoSourceType,
    oldState: AgoraStreamPublishState,
    newState: AgoraStreamPublishState,
    elapseSinceLastState: Int32
  ) {
    guard channelId == roomID, self.engine != nil, newState == .published else { return }
    event("localPublished")
  }

  /// Reports the string account associated with a remote numeric UID.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - userInfo: The RTC user information mapping a numeric UID to a string account.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didUserInfoUpdatedWithUserId uid: UInt,
    userInfo: AgoraUserInfo
  ) {
    event(
      "account",
      ["uid": uid, "userID": userInfo.userAccount ?? ""]
    )
  }

  /// Queries a remote user's string account after the user joins.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didJoinedOfUid uid: UInt,
    elapsed: Int
  ) {
    if let info = engine.getUserInfo(
      byUid: uid,
      withError: nil
    ) {
      event(
        "account",
        ["uid": uid, "userID": info.userAccount ?? ""]
      )
    }
  }

  /// Reports that a remote user no longer publishes video after leaving.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - reason: The native state transition reason code.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didOfflineOfUid uid: UInt,
    reason: AgoraUserOfflineReason
  ) {
    event(
      "publication",
      ["uid": uid, "published": false]
    )
  }

  /// Reports whether remote video publication is muted.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - muted: Whether the remote user has paused video publication.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didVideoMuted muted: Bool,
    byUid uid: UInt
  ) {
    event(
      "publication",
      ["uid": uid, "published": !muted]
    )
  }

  /// Reports publication state when a remote user enables or disables video.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - enabled: Whether the remote user has enabled the specified video capability.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didVideoEnabled enabled: Bool,
    byUid uid: UInt
  ) {
    event(
      "publication",
      ["uid": uid, "published": enabled]
    )
  }

  /// Reports whether a remote user has enabled local video capture.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - enabled: Whether the remote user has enabled the specified video capability.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didLocalVideoEnabled enabled: Bool,
    byUid uid: UInt
  ) {
    event(
      "publication",
      ["uid": uid, "published": enabled]
    )
  }

  /// Resolves remote video publication state from native user status flags before subscribing.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - state: The native remote user status flags.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    remoteUserStateChangedOfUid uid: UInt,
    state: UInt
  ) {
    event(
      "publication",
      ["uid": uid, "published": state & 2 == 0 && state & 16 != 0 && state & 256 != 0]
    )
  }

  /// Reports remote publication or its cessation from the received video state.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - state: The native remote video state.
  ///   - reason: The native state transition reason code.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    remoteVideoStateChangedOfUid uid: UInt,
    state: AgoraVideoRemoteState,
    reason: AgoraVideoRemoteReason,
    elapsed: Int
  ) {
    if state == .starting || state == .decoding {
      event(
        "publication",
        ["uid": uid, "published": true]
      )
    } else if reason == .remoteMuted || reason == .remoteOffline {
      event(
        "publication",
        ["uid": uid, "published": false]
      )
    }
  }

  /// Reports camera capture readiness or local video failure.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - state: The native local video state.
  ///   - reason: The native state transition reason code.
  ///   - sourceType: The native video source type for the frame or statistics.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    localVideoStateChangedOf state: AgoraVideoLocalState,
    reason: AgoraLocalVideoStreamReason,
    sourceType: AgoraVideoSourceType
  ) {
    if state == .capturing {
      event("captureReady")
    } else if state == .failed {
      event(
        "error",
        ["code": reason.rawValue]
      )
    }
  }

  /// Reports that the first local preview frame has rendered.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - size: The frame dimensions, in pixels.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    firstLocalVideoFrameWith size: CGSize,
    elapsed: Int
  ) {
    event(
      "localFrame",
      ["width": size.width, "height": size.height]
    )
  }

  /// Reports measured remote video dimensions when they change.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - sourceType: The native video source type for the frame or statistics.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - size: The frame dimensions, in pixels.
  ///   - rotation: The clockwise frame rotation reported by RTC, in degrees.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    videoSizeChangedOf sourceType: AgoraVideoSourceType,
    uid: UInt,
    size: CGSize,
    rotation: Int
  ) {
    if uid != 0 {
      event(
        "decoded",
        ["uid": uid, "width": size.width, "height": size.height]
      )
    }
  }

  /// Reports measured dimensions of the first decoded remote result frame.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - size: The frame dimensions, in pixels.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    firstRemoteVideoDecodedOfUid uid: UInt,
    size: CGSize,
    elapsed: Int
  ) {
    event(
      "decoded",
      ["uid": uid, "width": size.width, "height": size.height]
    )
  }

  /// Reports that the first remote frame is displayed, allowing the result view to become visible.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - size: The frame dimensions, in pixels.
  ///   - elapsed: The time elapsed since joining or preview startup, in milliseconds.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    firstRemoteVideoFrameOfUid uid: UInt,
    size: CGSize,
    elapsed: Int
  ) {
    event(
      "rendered",
      ["uid": uid, "width": size.width, "height": size.height]
    )
  }

  /// Reports uplink and downlink network quality codes for the local user.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - uid: The numeric RTC user identifier, mapped to a string account before notification.
  ///   - txQuality: The native uplink network quality code.
  ///   - rxQuality: The native downlink network quality code.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    networkQuality uid: UInt,
    txQuality: AgoraNetworkQuality,
    rxQuality: AgoraNetworkQuality
  ) {
    if uid == 0 {
      event(
        "quality",
        ["uplink": txQuality.rawValue, "downlink": rxQuality.rawValue]
      )
    }
  }

  /// Reports scalar local video statistics for capture, encoding, sending, bitrate, packet loss,
  /// and adaptation.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - stats: The native video statistics.
  ///   - sourceType: The native video source type for the frame or statistics.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    localVideoStats stats: AgoraRtcLocalVideoStats,
    sourceType: AgoraVideoSourceType
  ) {
    event(
      "uplinkStatistics",
      [
        "width": stats.encodedFrameWidth, "height": stats.encodedFrameHeight,
        "captureFrameRate": stats.captureFrameRate, "encodeFrameRate": stats.encoderOutputFrameRate,
        "sendFrameRate": stats.sentFrameRate, "bitrateKbps": stats.sentBitrate,
        "packetLossPercent": stats.txPacketLossRate,
        "adaptation": stats.qualityAdaptIndication.rawValue,
      ]
    )
  }

  /// Reports scalar subscribed result statistics for dimensions, frame rates, bitrate, packet loss,
  /// and latency.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - stats: The native video statistics.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    remoteVideoStats stats: AgoraRtcRemoteVideoStats
  ) {
    event(
      "downlinkStatistics",
      [
        "uid": stats.uid, "width": stats.width, "height": stats.height,
        "decodeFrameRate": stats.decoderOutputFrameRate,
        "renderFrameRate": stats.rendererOutputFrameRate,
        "bitrateKbps": stats.receivedBitrate, "packetLossPercent": stats.packetLossRate,
        "endToEndDelayMs": stats.e2eDelay,
      ]
    )
  }

  /// Reports a terminal native RTC connection error.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - state: The native RTC connection state.
  ///   - reason: The native state transition reason code.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    connectionChangedTo state: AgoraConnectionState,
    reason: AgoraConnectionChangedReason
  ) {
    if state == .failed {
      event(
        "error",
        ["code": reason.rawValue]
      )
    }
  }

  /// Reports token expiration as an RTC error, triggering cleanup of the current connection.
  ///
  /// - Parameter engine: The RTC engine that reports events or receives frames.
  func rtcEngineRequestToken(
    _ engine: AgoraRtcEngineKit
  ) {
    event(
      "error",
      ["code": "TOKEN_EXPIRED"]
    )
  }

  /// Reports a native RTC error using its numeric code.
  ///
  /// - Parameters:
  ///   - engine: The RTC engine that reports events or receives frames.
  ///   - errorCode: The native RTC error code.
  func rtcEngine(
    _ engine: AgoraRtcEngineKit,
    didOccurError errorCode: AgoraErrorCode
  ) {
    event(
      "error",
      ["code": errorCode.rawValue]
    )
  }
}

/// A weak video container reference that prevents the registry from retaining unmounted views.
private final class WeakView {

  /// The weak reference to the mounted view.
  weak var value: UIView?

  /// Creates a weak view reference.
  init(
    _ value: UIView
  ) { self.value = value }
}
