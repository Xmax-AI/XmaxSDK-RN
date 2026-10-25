//
//  XmaxRealtimeManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeExternalVideoSource } from '../../Media/External/RealtimeExternalVideoSource';

import type { RealtimeConfiguration } from './RealtimeConfiguration';
import type { RealtimeCameraPreset } from '../../Service/Realtime/RealtimeCameraPreset';
import type { RealtimeQualityLevel } from '../../Stream/Quality/RealtimeQualityLevel';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type {
  RealtimeState,
  RealtimeReason,
} from '../../Service/Realtime/RealtimeState';
import type {
  RealtimeOperationOptions,
  CameraStreamOptions,
  ImageStreamOptions,
} from './RealtimeOperationOptions';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type { RealtimeNetworkQuality } from '../../Service/Realtime/RealtimeNetworkQuality';
import type { RealtimePerformanceAlarm } from '../../Service/Realtime/RealtimePerformanceAlarm';
import type {
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '../../Foundation/RTC/VideoStatistics';

/**
 * A handler that receives the current state on registration and subsequent changes.
 *
 * @param state The current realtime state.
 */
export type RealtimeStateListener = (
  state: RealtimeState
) => void;

/**
 * A handler for RTC uplink and downlink network quality.
 *
 * @param quality The current uplink and downlink network quality.
 */
export type RealtimeNetworkQualityListener = (
  quality: RealtimeNetworkQuality,
) => void;

/**
 * A handler for encoder performance limitations and recovery.
 *
 * @param alarm The performance status and suggested encoding format.
 */
export type RealtimePerformanceAlarmListener = (
  alarm: RealtimePerformanceAlarm,
) => void;

/**
 * A handler for uplink statistics; clearing local publication delivers null.
 *
 * @param statistics The video statistics snapshot, or null when the corresponding stream is
 *   cleared.
 */
export type UplinkVideoStatisticsListener = (
  statistics: UplinkVideoStatistics | null,
) => void;

/**
 * A handler for subscribed result statistics; clearing the result stream delivers null.
 *
 * @param statistics The video statistics snapshot, or null when the corresponding stream is
 *   cleared.
 */
export type DownlinkVideoStatisticsListener = (
  statistics: DownlinkVideoStatistics | null,
) => void;

/**
 * An interface for local media, realtime connections, and video generation.
 *
 * Obtain an instance from XmaxClient.createRealtimeManager(). Each listener setter retains one
 * handler; null removes it. Close the manager when the screen finishes using it.
 *
 * Cancellable operations accept AbortSignal. Cancelling initial generation releases its connection;
 * cancelling a condition update preserves generation. Disconnect and close finish cleanup and are
 * not cancellable. New generation requests replace pending generation after required cleanup;
 * other foreground operation kinds remain exclusive. Foreground calls wait for an active
 * automatic quality update to finish.
 */
export interface XmaxRealtimeManaging {

  /**
   * The immutable realtime configuration.
   */
  readonly options: Readonly<RealtimeConfiguration>;

  /**
   * The latest state snapshot, committed before listener notification.
   */
  readonly currentState: RealtimeState;

  /**
   * The resolved camera format, or null without camera input. Transport quality does not change it.
   */
  readonly currentCameraVideoFormat: RealtimeVideoFormat | null;

  /**
   * The preset matching the camera dimensions, or null when no preset represents the format.
   */
  readonly currentCameraPreset: RealtimeCameraPreset | null;

  /**
   * The applied uplink level, or null before connection completes or after disconnection begins.
   */
  readonly uplinkQualityLevel: RealtimeQualityLevel | null;

  /**
   * The submitted downlink level. Received dimensions may change after this value changes.
   */
  readonly downlinkQualityLevel: RealtimeQualityLevel | null;

  /**
   * Updates a ready, disconnected camera stream while preserving its track and view bindings. A
   * preset changes dimensions while preserving frame rate, bitrate, and encoder preference.
   *
   * @param format The complete target format or camera resolution preset.
   * @param options The operation's cancellation options.
   */
  updateCameraFormat(
    format: RealtimeVideoFormat | RealtimeCameraPreset,
    options?: RealtimeOperationOptions,
  ): Promise<void>;

  /**
   * Changes uplink encoding quality during generation. The configured adaptation policy is unchanged;
   * failure retains the prior level.
   *
   * @param level The requested uplink quality level, from l1 to l5.
   * @param options The operation's cancellation options.
   */
  setUplinkQualityLevel(
    level: RealtimeQualityLevel,
    options?: RealtimeOperationOptions,
  ): Promise<void>;

  /**
   * Changes downlink quality during generation. The level updates after signal submission; received
   * dimensions may change later.
   *
   * @param level The requested downlink quality level, from l1 to l5.
   * @param options The operation's cancellation options.
   */
  setDownlinkQualityLevel(
    level: RealtimeQualityLevel,
    options?: RealtimeOperationOptions,
  ): Promise<void>;

  /**
   * The local preview volume; camera, image, and external input do not play local audio, so this is always 0.
   */
  readonly localAudioVolume: number;

  /**
   * The remote playback volume, from 0 to 1. Creating local input resets it to 0; set
   * playback volume after local stream creation.
   */
  readonly remoteAudioVolume: number;

  /**
   * Sets the state listener and immediately delivers currentState; null removes it.
   *
   * Completes after replacing the listener and delivering state; listener exceptions are isolated.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setStateListener(
    listener: RealtimeStateListener | null
  ): Promise<void>;

  /**
   * Sets the network quality listener; null removes it.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setNetworkQualityListener(
    listener: RealtimeNetworkQualityListener | null,
  ): Promise<void>;

  /**
   * Sets the performance listener without changing encoder settings; null removes it.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setPerformanceAlarmListener(
    listener: RealtimePerformanceAlarmListener | null,
  ): Promise<void>;

  /**
   * Sets the uplink statistics listener; disconnecting or closing delivers null.
   *
   * Immediately delivers null when no connection is active.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setUplinkVideoStatisticsListener(
    listener: UplinkVideoStatisticsListener | null,
  ): Promise<void>;

  /**
   * Sets the result statistics listener for the selected result account.
   *
   * Immediately delivers null when generation is inactive.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setDownlinkVideoStatisticsListener(
    listener: DownlinkVideoStatisticsListener | null,
  ): Promise<void>;

  /**
   * Validates local volume without enabling camera audio playback.
   *
   * Rejects invalid values; valid values do not enable local audio playback.
   *
   * @param volume The playback volume, from 0 for mute to 1 for maximum.
   */
  setLocalAudioVolume(
    volume: number
  ): Promise<void>;

  /**
   * Sets remote playback volume from 0 for mute to 1 for maximum.
   *
   * Completes after applying volume; rejects invalid values or native RTC failures.
   *
   * @param volume The playback volume, from 0 for mute to 1 for maximum.
   */
  setRemoteAudioVolume(
    volume: number
  ): Promise<void>;

  /**
   * Requests camera permission and starts capture in Preparing state. The state becomes Ready after
   * capture and preview binding are ready.
   *
   * Defaults to the front camera, the model format, and no microphone. Stop the current input
   * before replacement. Unsupported dimensions are rejected before permission requests for models
   * with fixed formats.
   *
   * @param options The camera position, video format, microphone, and cancellation settings.
   * @returns The manager-owned camera stream; rejects unsupported settings, denied permissions, or
   *   cancellation.
   */
  createLocalCameraStream(
    options?: CameraStreamOptions,
  ): Promise<RealtimeMediaStream>;

  /**
   * Stops capture after disconnect(). Image input is unchanged. Use close() to cancel pending work
   * and release all resources.
   *
   * Completes after camera release; rejects if connected, cancelled, or cleanup fails. Other input
   * types are unchanged.
   *
   * @param options The operation's cancellation options; manager lifecycle cancellation still
   *   applies when no signal is provided.
   */
  stopLocalCameraStream(
    options?: RealtimeOperationOptions
  ): Promise<void>;

  /**
   * Creates a continuous video frame stream from a local file or encoded image data.
   *
   * Uses a private, orientation-corrected copy retaining the image aspect ratio for RTC and local
   * preview. No camera or microphone permission is requested. Disconnect and stop the current input
   * before replacement. Your app owns the original; the manager owns the copy. Encoded bytes are
   * copied when this method is called and can be reused or modified afterward.
   *
   * @param options The image file URL or encoded bytes, encoding settings, frame rate, and
   *   cancellation signal; dimensions are resolved from the encoded image.
   * @returns The manager-owned image stream after its copy and frame source are prepared.
   */
  createLocalImageStream(
    options: ImageStreamOptions,
  ): Promise<RealtimeMediaStream>;

  /**
   * Stops image frames and deletes the copy after disconnect(). Camera input is unchanged. Use
   * close() to interrupt preparation.
   *
   * Completes after stopping frames and removing the copy; rejects if connected, cancelled, or
   * cleanup fails. Other input types are unchanged.
   *
   * @param options The operation's cancellation options; manager lifecycle cancellation still
   *   applies when no signal is provided.
   */
  stopLocalImageStream(
    options?: RealtimeOperationOptions
  ): Promise<void>;

  /**
   * Binds an app-owned external video source and optional PCM audio without requesting permissions.
   * Disconnect preserves capture and preview; stopping or closing invalidates the native sink.
   *
   * @param source The source owning native capture or decoding and its stable format.
   * @param options The operation cancellation settings.
   * @returns The local stream after source startup; rejects invalid formats or startup failures.
   */
  createExternalVideoStream(
    source: RealtimeExternalVideoSource,
    options?: RealtimeOperationOptions,
  ): Promise<RealtimeMediaStream>;

  /**
   * Stops external frame delivery after disconnection without affecting camera or image input.
   * Your app retains ownership of its capture resources.
   *
   * @param options The operation cancellation settings.
   */
  stopExternalVideoStream(
    options?: RealtimeOperationOptions
  ): Promise<void>;

  /**
   * Switches between cameras while preserving the local video track.
   *
   * During generation, switching restarts the task with cached conditions and retains the room on
   * success.
   *
   * @param options The operation's cancellation options; manager lifecycle cancellation still
   *   applies when no signal is provided.
   * @returns The existing camera stream after switching.
   */
  switchCamera(
    options?: RealtimeOperationOptions,
  ): Promise<RealtimeMediaStream>;

  /**
   * Establishes a realtime connection using a local stream created by this manager.
   *
   * Returns the result stream without starting generation. Its track can be bound before or after
   * generation startup. Repeated connect calls reject while a connection exists. RTC room admission
   * times out after 15 seconds.
   *
   * @param options The manager-owned local stream and cancellation signal.
   */
  connect(
    options: RealtimeOperationOptions & {

      /**
       * An active local stream created by this manager.
       */
      localStream: RealtimeMediaStream;
    },
  ): Promise<RealtimeMediaStream>;

  /**
   * Cancels realtime work and closes the session and room.
   *
   * Retains local media and returns to Ready, or Idle without local media. Final state includes the
   * termination reason. An inactive connection does not interrupt unrelated local preparation.
   *
   * Completes after remote cleanup while retaining local media. Concurrent calls share cleanup.
   *
   * @param options The termination reason; defaults to normal disconnection.
   */
  disconnect(
    options?: {

      /**
       * The reason reported in the final state.
       */
      reason?: RealtimeReason;
    }
  ): Promise<void>;

  /**
   * Cancels operations and releases the session, RTC, and local media.
   *
   * Completes in Idle with the termination reason. Concurrent calls share cleanup; the manager and
   * app listeners remain reusable. Independent storage tasks are unaffected.
   */
  close(): Promise<void>;

  /**
   * Connects local media if needed and starts generation or updates conditions.
   *
   * Initial generation requires context. Omitted or null context reuses the connection's last
   * successful conditions; disconnect and close clear that cache. This overload returns the result
   * stream after publication and first-frame readiness. Audio is enabled after the first frame;
   * no mounted result view is required for completion.
   *
   * A newer call to either overload replaces an unfinished generation request. The replaced call
   * rejects with CANCELLED after required cleanup. Requests do not replace other operation kinds.
   *
   * @param options The local stream, generation conditions, face restoration, and cancellation
   *   settings.
   * @returns The manager-owned result stream after task confirmation.
   */
  startGeneration(
    options: RealtimeOperationOptions & {

      /**
       * An active local stream created by this manager.
       */
      localStream: RealtimeMediaStream;

      /**
       * The generation prompt and reference image location.
       */
      context?: RealtimeContext | null;

      /**
       * Whether to restore the source face for this request; defaults to false.
       */
      faceRestoration?: boolean;
    },
  ): Promise<RealtimeMediaStream>;

  /**
   * Starts generation or updates conditions on an existing connection.
   *
   * Uses the same request-replacement behavior as the localStream overload. New tasks wait for
   * publication and a decoded first frame from the result account, then enable result audio.
   * Updates reuse the task and complete after signal submission.
   *
   * @param options The generation conditions, face restoration, and cancellation settings.
   */
  startGeneration(
    options?: RealtimeOperationOptions & {

      /**
       * The generation prompt and reference image location.
       */
      context?: RealtimeContext | null;

      /**
       * Whether to restore the source face for this request; defaults to false.
       */
      faceRestoration?: boolean;
    },
  ): Promise<void>;
}
