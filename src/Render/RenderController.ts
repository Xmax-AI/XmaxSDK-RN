//
//  RenderController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../Foundation/Logging/XmaxLogger';
import type { InteractionController } from '../Media/Interaction/InteractionController';
import { invalid } from '../Foundation/Errors/XmaxError';
import type { RtcManager, RemoteStream } from '../Foundation/RTC/RtcManager';
import type {
  CameraPosition,
  RealtimeMediaStream,
  RealtimeVideoFormat,
  RealtimeVideoTrack,
} from '../Service/Realtime/RealtimeTypes';

/**
 * The mutable rendering state behind a public video track.
 */
export interface VideoBinding {

  /**
   * The unique identifier of this render binding.
   */
  readonly id: string;

  /**
   * The ownership identity used to reject retired resource holders.
   */
  readonly owner: object;

  /**
   * The RTC engine and room adapter for this manager.
   */
  readonly rtc: RtcManager;

  /**
   * Whether this binding represents local input.
   */
  readonly local: boolean;

  /**
   * Notifies lifecycle coordination when local preview binding is ready.
   */
  readonly onPreviewReady?: () => void;

  /**
   * Forwards native canvas failures to the owning lifecycle.
   *
   * @param error The failure reported by the operation.
   */
  readonly onBindingFailure?: (
    error: unknown
  ) => void;

  /**
   * The interaction controller for remote output; local preview does not submit interactions.
   */
  readonly interaction: InteractionController | null;

  /**
   * Whether this binding still represents an active stream.
   */
  valid: boolean;

  /**
   * Whether output display is retiring, independently of binding validity.
   */
  retiring: boolean;

  /**
   * The shared task awaiting native output hiding.
   */
  retirement: Promise<void> | null;

  /**
   * The native view hiding operations that must complete before remote release.
   */
  readonly hideBeforeRelease: Set<() => Promise<void>>;

  /**
   * Whether the current remote task is confirmed.
   */
  confirmed: boolean;

  /**
   * The video dimensions, frame rate, and encoder bitrate settings.
   */
  format: RealtimeVideoFormat;

  /**
   * The camera position; image and remote tracks have no position.
   */
  position: CameraPosition | null;

  /**
   * The remote room and account; absent for local bindings.
   */
  remote: RemoteStream | null;

  /**
   * The private image copy used by RN Image rather than an RTC canvas.
   */
  imageURL: string | null;

  /**
   * The revision used to reject late asynchronous results.
   */
  version: number;

  /**
   * The subscribers to binding or resource changes.
   */
  readonly listeners: Set<() => void>;
}

/**
 * The weak registry from public video tracks to render bindings.
 */
const tracks = new WeakMap<RealtimeVideoTrack, VideoBinding>();

/**
 * The weak registry from public streams to local or remote bindings.
 */
const streams = new WeakMap<RealtimeMediaStream, VideoBinding>();

/**
 * Looks up a track binding without creating one.
 *
 * @param track The video track to look up.
 * @returns The binding, or null if the track is absent or not owned by the SDK.
 */
export function videoBinding(
  track: RealtimeVideoTrack | null | undefined,
): VideoBinding | null {
  return track ? tracks.get(track) ?? null : null;
}

/**
 * Notifies mounted video components of binding changes while preserving track identity.
 *
 * @param binding The binding used for rendering, interaction, and cleanup.
 */
export function refreshBinding(
  binding: VideoBinding
): void {
  binding.version++;

  for (const listener of [...binding.listeners]) listener();
}

/**
 * Coordinates video tracks, render bindings, and trajectory rendering.
 */
export class RenderController {

  /**
   * The active bindings created by this render controller.
   */
  private owned = new Set<VideoBinding>();

  /**
   * Creates a render registry with preview readiness and failure handlers.
   */
  constructor(
    /**
     * The owner identity; retired owners cannot modify replacement resources.
     */
    private readonly owner: object,

    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManager,

    /**
     * The interaction controller for the active task.
     */
    private readonly interaction: InteractionController | null = null,

    /**
     * The handler invoked when local preview is ready.
     *
     * @param binding The affected local or remote track binding.
     */
    private readonly onPreviewReady?: (
      binding: VideoBinding
    ) => void,

    /**
     * The handler for native canvas registration or binding failure.
     *
     * @param binding The affected local or remote track binding.
     * @param error The normalized native canvas error.
     */
    private readonly onBindingFailure?: (
      binding: VideoBinding,
      error: unknown,
    ) => void,
  ) {}

  /**
   * Creates a stream and stable track backed by mutable render state.
   *
   * @param local Whether the media is local; null selects both directions where supported.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param position The front or rear camera position.
   * @param remote The remote room and account; null denotes local media.
   * @param imageURL The local preview image URL; null selects RTC rendering.
   * @returns The stream and video track owned by this controller.
   */
  create(
    local: boolean,
    format: RealtimeVideoFormat,
    position: CameraPosition | null,
    remote: RemoteStream | null = null,
    imageURL: string | null = null,
  ): RealtimeMediaStream {
    const binding: VideoBinding = {
      id: this.rtc.randomUUID(),
      owner: this.owner,
      rtc: this.rtc,
      local,
      onPreviewReady: () => {
        if (local && position && binding.valid) this.onPreviewReady?.(binding);
      },
      onBindingFailure: error => this.onBindingFailure?.(
        binding,
        error
      ),
      interaction: local ? null : this.interaction,
      valid: true,
      retiring: false,
      retirement: null,
      hideBeforeRelease: new Set(),
      confirmed: false,
      format: Object.freeze({ ...format }),
      position,
      remote,
      imageURL,
      version: 0,
      listeners: new Set(),
    };
    const track: RealtimeVideoTrack = Object.freeze({
      id: local ? 'video-local' : remote?.userID ?? 'video-remote',
      /**
       * The track format, or null after binding invalidation.
       */
      get videoFormat() {
        return binding.valid ? binding.format : null;
      },
      /**
       * The camera position, or null for invalid, image, or remote bindings.
       */
      get position() {
        return binding.valid ? binding.position : null;
      },
    });
    const stream: RealtimeMediaStream = Object.freeze({
      id: local ? 'stream-local' : 'stream-remote',
      videoTrack: track,
    });

    tracks.set(
      track,
      binding
    );
    streams.set(
      stream,
      binding
    );
    this.owned.add(binding);

    return stream;
  }

  /**
   * Requires an active local binding owned by this controller.
   *
   * @param stream The manager-owned local media stream.
   * @returns The active owned binding; foreign or invalidated streams throw.
   */
  requireLocal(
    stream: RealtimeMediaStream
  ): VideoBinding {
    const binding = streams.get(stream);

    if (
      !binding ||
      binding.owner !== this.owner ||
      !binding.local ||
      !binding.valid
    )
      throw invalid('Local stream does not belong to this active manager');

    return binding;
  }

  /**
   * Updates measured return dimensions while preserving source media and canvas identity.
   *
   * @param stream The remote stream's room and account.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   */
  updateRemoteFormat(
    stream: RemoteStream,
    width: number,
    height: number,
  ): void {
    if (
      ![width, height].every(value => Number.isSafeInteger(value) && value > 0)
    )
      return;
    for (const binding of this.owned) {
      if (
        !binding.local &&
        binding.valid &&
        binding.remote?.roomID === stream.roomID &&
        binding.remote.userID === stream.userID &&
        (binding.format.width !== width || binding.format.height !== height)
      ) {
        binding.format = Object.freeze({ ...binding.format, width, height });
        refreshBinding(binding);
      }
    }
  }

  /**
   * Hides native result views before stop signaling or room cleanup to avoid revealing a cleared
   * canvas.
   *
   * Completes after all result views are hidden, before RTC release.
   */
  async hideRemote(): Promise<void> {
    await Promise.all(
      [...this.owned]
        .filter(binding => !binding.local)
        .map(binding => {
          if (binding.retirement) return binding.retirement;
          const hides = [...binding.hideBeforeRelease];
          binding.retiring = true;
          refreshBinding(binding);
          binding.retirement = Promise.all(
            hides.map(async hide => {
              try {
                await hide();
              } catch {
                // Missing or retired views must not block room and session cleanup.
                XmaxLogger.render.warn(
                  'Native video hide failed during teardown',
                );
              }
            }),
          ).then(() => {});

          return binding.retirement;
        }),
    );
  }

  /**
   * Invalidates local or remote tracks so released resources cannot be reused.
   *
   * @param local True selects local bindings, false selects remote bindings, and null selects both.
   */
  invalidate(
    local: boolean | null = null
  ): void {
    for (const binding of this.owned)
      if (local === null || binding.local === local) {
        binding.valid = false;
        refreshBinding(binding);
        this.owned.delete(binding);
      }
  }
}
