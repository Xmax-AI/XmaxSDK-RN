//
//  RtcManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RemoteStream } from './RemoteStream';
import type { RtcEvent } from './RtcEvent';

import type { CameraPosition } from '../Media/Camera/CameraPosition';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type { VideoContentMode } from '../Media/Video/VideoContentMode';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RuntimeInfo } from '../Runtime/RuntimeInfo';

/**
 * An interface for RTC leases, native media operations, rooms, and normalized events.
 */
export interface RtcManaging {

  /**
   * The platform, system, device, and SDK version metadata attached to service requests.
   */
  readonly runtime: RuntimeInfo;

  /**
   * Creates a UUID for a stream, operation, or media owner.
   */
  randomUUID(): string;

  /**
   * Subscribes to normalized RTC events and returns an unsubscribe function.
   *
   * @param listener The RTC event handler.
   * @returns The idempotent unsubscribe function.
   */
  onEvent(
    listener: (
      event: RtcEvent
    ) => void
  ): () => void;

  /**
   * The remote string accounts currently publishing in the room.
   */
  readonly publishedStreams: readonly RemoteStream[];

  /**
   * Reads transport quality preferences; this interface does not store credentials.
   *
   * @param key The lookup key for resources, preferences, or message coalescing.
   * @returns The saved JSON, or the string null if no preference exists.
   */
  readPreference(
    key: string
  ): Promise<string>;

  /**
   * Stores transport quality preferences without credentials or user content.
   *
   * @param key The lookup key for resources, preferences, or message coalescing.
   * @param value The serialized quality preference, excluding credentials and user content.
   */
  writePreference(
    key: string,
    value: string
  ): Promise<void>;

  /**
   * Acquires exclusive foreground media ownership and initializes native RTC.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  open(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Starts the selected camera and waits for capture readiness; bind preview after receiving its
   * track.
   *
   * Completes when capture is ready; rejects on startup failure, cancellation, or timeout.
   *
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param position The front or rear camera position.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  startCamera(
    format: RealtimeVideoFormat,
    position: CameraPosition,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Switches cameras through the current engine while preserving the local track.
   *
   * Completes after native switching and mirror configuration.
   *
   * @param position The front or rear camera position.
   */
  switchCamera(
    position: CameraPosition
  ): Promise<void>;

  /**
   * Updates disconnected preview capture and encoding in place, restoring the prior native format
   * on failure.
   *
   * @param format The requested camera dimensions, frame rate, and encoder preference.
   * @param minimum The minimum uplink bitrate, in kbps.
   * @param maximum The maximum uplink bitrate, in kbps.
   */
  updateCameraFormat(
    format: RealtimeVideoFormat,
    minimum: number,
    maximum: number,
  ): Promise<void>;

  /**
   * Selects native external-frame input before joining the room.
   *
   * Completes after external input configuration; rejects unavailable engines or joined rooms.
   */
  configureImageSource(): Promise<void>;

  /**
   * Creates a native receiver for upright external frames and optional PCM audio.
   *
   * @param sinkID The attachment identity passed to the app's native producer.
   * @param sourceFormat The declared input dimensions and cadence.
   * @param format The processed preview and encoding baseline dimensions.
   * @param hasAudio Whether the source supplies external audio without microphone capture.
   */
  startExternalSource(
    sinkID: string,
    sourceFormat: RealtimeVideoFormat,
    format: RealtimeVideoFormat,
    hasAudio: boolean,
  ): Promise<void>;

  /**
   * Repeats native image frames at the requested cadence without passing pixels through JS.
   *
   * Completes after native decoding and periodic frame delivery are configured.
   *
   * @param path The absolute path of the SDK-owned image copy.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   */
  startImage(
    path: string,
    format: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * Sets uplink dimensions, frame rate, bitrate, and preference without changing source dimensions.
   *
   * Completes when the native encoder accepts the configuration.
   *
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param minimum The minimum uplink bitrate, in kbps; 0 leaves the minimum unrestricted.
   * @param maximum The positive maximum uplink bitrate, in kbps, not below the minimum.
   */
  configureEncoding(
    format: RealtimeVideoFormat,
    minimum: number,
    maximum: number,
  ): Promise<void>;

  /**
   * Joins an authenticated RTC room and creates an ordered data channel.
   *
   * Completes after room join and data-channel creation; rejects on failure, cancellation, or
   * timeout.
   *
   * @param connection The session room, user account, token, and expected result account.
   * @param microphone Whether microphone input is required.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   */
  join(
    connection: RealtimeSessionConnection,
    microphone: boolean,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Waits for a new decoded frame from the expected room and account without a mounted view.
   *
   * @param stream The confirmed result stream identity.
   * @param signal The operation cancellation signal.
   */
  waitUntilRemoteFrameReady(
    stream: RemoteStream,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Changes the result account's audio subscription without changing playback volume.
   *
   * @param stream The result room and account.
   * @param enabled Whether to receive the result account's audio.
   */
  setRemoteAudioSubscription(
    stream: RemoteStream,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Submits encoded messages in order within the room's rate limits.
   *
   * Completes after all packets reach native transport; rejects on cancellation or submission
   * failure.
   *
   * @param message The message content to send.
   * @param interaction Whether this is a coalescible task interaction message; defaults to false.
   */
  send(
    message: string,
    interaction?: boolean
  ): Promise<void>;

  /**
   * Discards pending task interactions before enqueuing its stop signal.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   */
  discardTracks(
    taskID: string
  ): void;

  /**
   * Sets result playback volume, from 0 to 1.
   *
   * Completes after applying volume; rejects invalid values or native RTC failures.
   *
   * @param volume The playback volume, from 0 for mute to 1 for maximum.
   */
  setRemoteAudioVolume(
    volume: number
  ): Promise<void>;

  /**
   * Binds a mounted container to local input or a remote account with the requested scaling.
   *
   * Completes after native binding acknowledgment. Unmapped accounts defer binding until mapping
   * arrives.
   *
   * @param viewID The unique native identity of the mounted container.
   * @param stream The remote room and account, or null for local input.
   * @param mode The video fit or fill scaling mode.
   */
  bind(
    viewID: string,
    stream: RemoteStream | null,
    mode: VideoContentMode,
  ): Promise<void>;

  /**
   * Detaches a container only while it still belongs to this stream, preserving replacement
   * bindings.
   *
   * @param viewID The unique native identity of the mounted container.
   * @param stream The remote room and account, or null for local input.
   */
  unbind(
    viewID: string,
    stream: RemoteStream | null
  ): void;

  /**
   * Cancels pending messages, detaches result rendering, and leaves the room while retaining local
   * input.
   *
   * Completes after queue cancellation and RTC room exit.
   */
  leave(): Promise<void>;

  /**
   * Pauses local video and microphone capture without awaiting engine destruction.
   */
  stopLocalCapture(): void;

  /**
   * Stops capture, rejects pending messages, and releases the engine and media ownership.
   * Concurrent calls share cleanup.
   */
  close(): Promise<void>;
}
