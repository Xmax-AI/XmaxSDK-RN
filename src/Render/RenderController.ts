//
//  RenderController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RenderControlling } from './RenderControlling';
import type { VideoRenderBinding } from './Video/VideoRenderBinding';
import {
  registerVideoRenderBinding,
  streamBinding,
  refreshBinding,
} from './Video/VideoRenderRegistry';
import { XmaxLogger } from '../Foundation/Logging/XmaxLogger';
import type { InteractionControlling } from '../Media/Interaction/InteractionControlling';
import { invalid } from '../Foundation/Errors/XmaxError';
import type { RtcManaging } from '../Foundation/RTC/RtcManaging';
import type { RemoteStream } from '../Foundation/RTC/RemoteStream';
import type { CameraPosition } from '../Foundation/Media/Camera/CameraPosition';
import type { RealtimeMediaStream } from '../Service/Realtime/RealtimeMediaStream';
import type { RealtimeVideoFormat } from '../Service/Realtime/RealtimeVideoFormat';
import type { RealtimeVideoTrack } from '../Service/Realtime/RealtimeVideoTrack';

/**
 * Coordinates video tracks, render bindings, and trajectory rendering.
 */
export class RenderController implements RenderControlling {

  /**
   * The active bindings created by this render controller.
   */
  private owned = new Set<VideoRenderBinding>();

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
    private readonly rtc: RtcManaging,

    /**
     * The interaction controller for the active task.
     */
    private readonly interaction: InteractionControlling | null = null,

    /**
     * The handler invoked when local preview is ready.
     *
     * @param binding The affected local or remote track binding.
     */
    private onPreviewReady?: (
      binding: VideoRenderBinding
    ) => void,

    /**
     * The handler for native canvas registration or binding failure.
     *
     * @param binding The affected local or remote track binding.
     * @param error The normalized native canvas error.
     */
    private onBindingFailure?: (
      binding: VideoRenderBinding,
      error: unknown,
    ) => void,
  ) {}

  /**
   * Sets the listener notified when the current local preview becomes ready.
   *
   * @param listener The preview readiness handler, or null to remove it.
   */
  setPreviewReadyListener(
    listener: ((
      binding: VideoRenderBinding
    ) => void) | null,
  ): void {
    this.onPreviewReady = listener ?? undefined;
  }

  /**
   * Sets the listener receiving native canvas registration and binding failures.
   *
   * @param listener The binding failure handler, or null to remove it.
   */
  setBindingFailureListener(
    listener: ((
      binding: VideoRenderBinding,
      error: unknown
    ) => void) | null,
  ): void {
    this.onBindingFailure = listener ?? undefined;
  }

  /**
   * Creates a stream and stable track backed by mutable render state.
   *
   * @param local Whether this stream represents local input.
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
    const binding: VideoRenderBinding = {
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

    registerVideoRenderBinding(
      stream,
      track,
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
  ): VideoRenderBinding {
    const binding = streamBinding(stream);

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
   * Updates remote stream confirmation without replacing the public track.
   *
   * @param stream The manager-owned result stream.
   * @param remote The confirmed RTC room and account; null hides output while retaining its binding.
   */
  setRemoteStream(
    stream: RealtimeMediaStream,
    remote: RemoteStream | null,
  ): void {
    const binding = streamBinding(stream);
    if (!binding || binding.owner !== this.owner || binding.local) return;

    if (remote) binding.remote = remote;
    binding.confirmed = remote !== null;
    refreshBinding(binding);
  }

  /**
   * Waits for a new decoded result frame without requiring a mounted video view.
   *
   * @param remote The confirmed result room and account.
   * @param signal The generation operation cancellation signal.
   */
  async waitUntilRemoteFrameReady(
    remote: RemoteStream,
    signal: AbortSignal,
  ): Promise<void> {
    const binding = [...this.owned].find(
      value =>
        !value.local &&
        value.valid &&
        !value.retiring &&
        (!value.remote ||
          (value.remote.roomID === remote.roomID &&
            value.remote.userID === remote.userID)),
    );
    if (!binding) throw invalid('Remote video stream is unavailable');
    await this.rtc.waitUntilRemoteFrameReady(
      remote,
      signal
    );
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
                  XmaxLogger.localized(
                    '释放资源时隐藏原生视频失败',
                    'Native video hide failed during teardown',
                  ),
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
