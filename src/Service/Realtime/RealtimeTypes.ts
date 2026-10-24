//
//  RealtimeTypes.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxError } from '../../Foundation/Errors/XmaxError';

/**
 * A realtime generation model supported by XmaxSDK.
 */
export enum RealtimeModel {

  /**
   * The X2.1 realtime model; the client environment determines service routing.
   */
  x2_1 = 'x2.1',
}

/**
 * A camera resolution preset whose availability depends on the selected model.
 */
export enum RealtimeCameraPreset {

  /**
   * A landscape 16:9 frame.
   */
  resolution1920x1080 = '1920x1080',

  /**
   * A portrait 9:16 frame.
   */
  resolution1080x1920 = '1080x1920',

  /**
   * A square frame.
   */
  resolution1408x1408 = '1408x1408',

  /**
   * A portrait 3:4 frame.
   */
  resolution1152x1536 = '1152x1536',

  /**
   * A landscape 4:3 frame.
   */
  resolution1536x1152 = '1536x1152',
}

/**
 * Transport quality levels, ordered from highest to lowest quality. Manual changes retain automatic
 * adaptation.
 */
export enum RealtimeQualityLevel {

  /**
   * The highest transport quality.
   */
  l1 = 1,

  /**
   * The default transport quality.
   */
  l2 = 2,

  /**
   * Reduced dimensions for constrained bandwidth.
   */
  l3 = 3,

  /**
   * Further reduced dimensions and uplink frame rate.
   */
  l4 = 4,

  /**
   * The lowest transport quality, prioritizing delivery continuity.
   */
  l5 = 5,
}

/**
 * The generation canvas and local media constraints for a model.
 */
export interface RealtimeModelSpecification {

  /**
   * The supported camera and canvas dimensions, in pixels, with recommended frame rates.
   */
  readonly supportedVideoFormats: readonly RealtimeVideoFormat[];

  /**
   * The minimum input pixel area declared as model metadata.
   */
  readonly minimumInputPixels: number;

  /**
   * The maximum image pixel area before downscaling.
   */
  readonly maximumInputPixels: number;

  /**
   * The dimension alignment, in pixels, declared by the model.
   */
  readonly inputSizeAlignment: number;

  /**
   * The default local input frame rate, in fps.
   */
  readonly defaultFrameRate: number;

  /**
   * The model's default camera capture dimensions and frame rate.
   */
  readonly defaultCameraVideoFormat: RealtimeVideoFormat;
}

/**
 * The X2.1 canvas formats, image area limits, and default camera format.
 */
const specification: RealtimeModelSpecification = Object.freeze({
  supportedVideoFormats: Object.freeze([
    Object.freeze({ width: 1920, height: 1080, fps: 30 }),
    Object.freeze({ width: 1080, height: 1920, fps: 30 }),
    Object.freeze({ width: 1408, height: 1408, fps: 30 }),
    Object.freeze({ width: 1152, height: 1536, fps: 30 }),
    Object.freeze({ width: 1536, height: 1152, fps: 30 }),
  ]),
  minimumInputPixels: 600000,
  maximumInputPixels: 2100000,
  inputSizeAlignment: 32,
  defaultFrameRate: 30,
  defaultCameraVideoFormat: Object.freeze({
    width: 1080,
    height: 1920,
    fps: 30,
  }),
});

/**
 * The sizing constraints for supported generation models.
 */
export const realtimeModelSpecifications: Readonly<
  Record<RealtimeModel, RealtimeModelSpecification>
> = Object.freeze({
  [RealtimeModel.x2_1]: specification,
});

/**
 * The local input source; image aspect ratio is independent of the generation canvas.
 */
export enum RealtimeMediaSource {

  /**
   * Local camera input.
   */
  camera = 'camera',

  /**
   * Local image input delivered as repeated, orientation-corrected video frames.
   */
  image = 'image',
}

/**
 * The camera position.
 */
export enum CameraPosition {

  /**
   * The front camera.
   */
  front = 'front',

  /**
   * The rear camera.
   */
  back = 'back',
}

/**
 * The aspect-preserving scaling mode for video inside its view.
 */
export enum VideoContentMode {

  /**
   * Fills the view and crops content outside its bounds.
   */
  fill = 'fill',

  /**
   * Displays the complete frame with space around it when needed.
   */
  fit = 'fit',
}

/**
 * The lifecycle state of local media, the room connection, and generation.
 */
export enum RealtimeConnectionState {

  /**
   * No local media or active connection is held.
   */
  idle = 'Idle',

  /**
   * The local input is being prepared or its preview is not yet ready.
   */
  preparing = 'Preparing',

  /**
   * The local input is ready without a remote connection.
   */
  ready = 'Ready',

  /**
   * The server session is being created or the RTC room is connecting.
   */
  connecting = 'Connecting',

  /**
   * The room is joined and the result stream exists, but generation is not yet confirmed.
   */
  connected = 'Connected',

  /**
   * The current task is generating video.
   */
  generating = 'Generating',

  /**
   * An operation is being cancelled and its associated resources are being released.
   */
  disconnecting = 'Disconnecting',
}

/**
 * The connection quality reported by RTC.
 */
export enum RealtimeNetworkQualityLevel {

  /**
   * No valid quality measurement is available.
   */
  unknown = 'Unknown',

  /**
   * The network quality is excellent.
   */
  excellent = 'Excellent',

  /**
   * The network quality is good.
   */
  good = 'Good',

  /**
   * The network quality is fair.
   */
  poor = 'Poor',

  /**
   * The network quality is poor; consecutive samples may trigger a lower encoding level.
   */
  bad = 'Bad',

  /**
   * The network quality is very poor; consecutive samples may trigger a lower encoding level.
   */
  veryBad = 'VeryBad',

  /**
   * The network connection is unavailable.
   */
  down = 'Down',
}

/**
 * The state of encoding performance constraints or recovery.
 */
export enum RealtimePerformanceStatus {

  /**
   * Encoding performance is constrained.
   */
  limited = 'Limited',

  /**
   * Encoding performance has recovered.
   */
  recovered = 'Recovered',
}

/**
 * The model configuration used to create a realtime manager.
 */
export interface RealtimeConfiguration {

  /**
   * The model that determines media constraints and generation capabilities.
   */
  readonly model: RealtimeModel;
}

/**
 * The width and height of an image or video, in pixels.
 */
export interface MediaSize {

  /**
   * The width, in pixels.
   */
  readonly width: number;

  /**
   * The height, in pixels.
   */
  readonly height: number;
}

/**
 * The encoding preference for balancing frame rate and resolution.
 */
export enum RealtimeVideoEncoderPreference {

  /**
   * Balances frame rate and resolution.
   */
  auto = 'auto',

  /**
   * Prioritizes frame rate; this is the default preference.
   */
  maintainFramerate = 'maintainFramerate',

  /**
   * Prioritizes image quality.
   */
  maintainQuality = 'maintainQuality',
}

/**
 * The video dimensions, frame rate, and uplink encoding settings.
 */
export interface RealtimeVideoFormat extends MediaSize {

  /**
   * The video frame rate, in fps; must be a positive integer.
   */
  readonly fps: number;

  /**
   * The minimum encoding bitrate, in kbps; defaults to 500, capped at the maximum bitrate. A value
   * of 0 removes the lower limit.
   */
  readonly minimumBitrate?: number | null;

  /**
   * The maximum encoding bitrate, in kbps; must be a positive integer. Defaults to the value
   * calculated by the SDK bitrate policy.
   */
  readonly maximumBitrate?: number | null;

  /**
   * The encoding preference; defaults to maintainFramerate and is preserved when input dimensions
   * are calculated.
   */
  readonly encoderPreference?: RealtimeVideoEncoderPreference;
}

/**
 * The prompt and reference image for a generation task.
 */
export interface RealtimeContext {

  /**
   * The generation prompt; leading and trailing whitespace is removed before submission.
   */
  readonly prompt: string;

  /**
   * The remote reference image path. A blank, null, or omitted value in new conditions clears the
   * reference image.
   */
  readonly referencePath?: string | null;
}

/**
 * The lifecycle termination reason, cleared when a new operation begins.
 */
export type RealtimeReason =
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'normal';
    }
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'orientationChanged';
    }
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'failure';

      /**
       * The SDK error associated with the event or final state.
       */
      readonly error: XmaxError;
    };

/**
 * An immutable snapshot of the current connection and generation identifiers.
 */
export interface RealtimeState {

  /**
   * The current realtime lifecycle state.
   */
  readonly connectionState: RealtimeConnectionState;

  /**
   * The reason for completion, an orientation change, or failure; null while a new operation is in
   * progress.
   */
  readonly reason: RealtimeReason | null;

  /**
   * The current or most recent session identifier, retained after termination.
   */
  readonly sessionID: string | null;

  /**
   * The current generation task identifier; null when no task is generating.
   */
  readonly taskID: string | null;
}

/**
 * A manager-owned video track with stable object identity.
 *
 * The format and camera position reflect the current binding and are cleared when it becomes
 * invalid. Do not construct replacement tracks.
 */
export interface RealtimeVideoTrack {

  /**
   * The stable identifier of this video track.
   */
  readonly id: string;

  /**
   * The current video dimensions and frame rate.
   */
  readonly videoFormat: RealtimeVideoFormat | null;

  /**
   * The camera position; image and remote tracks have no position.
   */
  readonly position: CameraPosition | null;
}

/**
 * A manager-owned local or remote stream. Connections accept only streams created by the same
 * manager.
 */
export interface RealtimeMediaStream {

  /**
   * The stable identifier of this media stream.
   */
  readonly id: string;

  /**
   * The currently valid video track.
   */
  readonly videoTrack: RealtimeVideoTrack | null;
}

/**
 * A snapshot of RTC uplink and downlink network quality.
 */
export interface RealtimeNetworkQuality {

  /**
   * The uplink connection quality.
   */
  readonly uplink: RealtimeNetworkQualityLevel;

  /**
   * The downlink connection quality.
   */
  readonly downlink: RealtimeNetworkQualityLevel;
}

/**
 * The encoding performance state and recommended format; capture settings are not changed
 * automatically.
 */
export interface RealtimePerformanceAlarm {

  /**
   * The state of encoding performance constraints or recovery.
   */
  readonly status: RealtimePerformanceStatus;

  /**
   * The recommended encoding dimensions and frame rate.
   */
  readonly suggestedVideoFormat: RealtimeVideoFormat | null;
}

/**
 * The cancellation options for an individual SDK operation.
 */
export interface RealtimeOperationOptions {

  /**
   * Cancels this call. Its Promise rejects after the required lifecycle cleanup completes.
   */
  readonly signal?: AbortSignal;
}

/**
 * The capture options for createLocalCameraStream().
 */
export interface CameraStreamOptions extends RealtimeOperationOptions {

  /**
   * The capture format; defaults to the model format of 1080 × 1920 at 30 fps. Dimensions must
   * match a supported model format.
   */
  readonly videoFormat?: RealtimeVideoFormat;

  /**
   * A camera resolution preset using the model-recommended frame rate; cannot be combined with
   * videoFormat.
   */
  readonly preset?: RealtimeCameraPreset;

  /**
   * The camera position; defaults to CameraPosition.front.
   */
  readonly position?: CameraPosition;

  /**
   * Whether to request microphone permission and publish audio when connected; defaults to false.
   */
  readonly useMicrophone?: boolean;
}

/**
 * The options for a local image repeatedly sent as video frames.
 */
export interface ImageStreamOptions extends RealtimeOperationOptions {

  /**
   * A local file URL or absolute path. Android also accepts a readable content URI.
   */
  readonly fileURL: string;

  /**
   * Overrides the frame rate, bitrate, or encoding preference. Dimensions remain subject to the
   * file and model limits. Image input supports 1–60 fps and defaults to the model frame rate, SDK
   * bitrate policy, and maintainFramerate preference.
   */
  readonly videoFormat?: RealtimeVideoFormat | null;
}

/**
 * The camera format for the default model.
 */
export const defaultCameraVideoFormat: RealtimeVideoFormat =
  realtimeModelSpecifications[RealtimeModel.x2_1].defaultCameraVideoFormat;

/**
 * The uplink video statistics; unavailable values are null.
 */
export interface UplinkVideoStatistics {

  /**
   * The actual encoded width, in pixels.
   */
  readonly width: number | null;

  /**
   * The actual encoded height, in pixels.
   */
  readonly height: number | null;

  /**
   * The actual capture frame rate, in fps.
   */
  readonly captureFrameRate: number | null;

  /**
   * The actual encoder output frame rate, in fps.
   */
  readonly encodeFrameRate: number | null;

  /**
   * The actual sending frame rate, in fps, excluding retransmissions.
   */
  readonly sendFrameRate: number | null;

  /**
   * The actual sending bitrate, in kbps, excluding retransmissions.
   */
  readonly bitrateKbps: number | null;

  /**
   * The video packet loss rate from the device to the RTC server before loss recovery, as a
   * percentage from 0 to 100.
   */
  readonly packetLossPercent: number | null;
}

/**
 * The statistics for the subscribed generation result; unavailable numeric values are null.
 */
export interface DownlinkVideoStatistics {

  /**
   * The string user account publishing the subscribed generation result.
   */
  readonly userID: string;

  /**
   * The received video width, in pixels.
   */
  readonly width: number | null;

  /**
   * The received video height, in pixels.
   */
  readonly height: number | null;

  /**
   * The actual decoder output frame rate, in fps.
   */
  readonly decodeFrameRate: number | null;

  /**
   * The actual rendering frame rate, in fps.
   */
  readonly renderFrameRate: number | null;

  /**
   * The actual receiving bitrate over the latest reporting interval, in kbps.
   */
  readonly bitrateKbps: number | null;

  /**
   * The subscribed video packet loss rate after loss recovery, as a percentage from 0 to 100.
   */
  readonly packetLossPercent: number | null;

  /**
   * The end-to-end video latency, in milliseconds.
   */
  readonly endToEndDelayMs: number | null;
}
