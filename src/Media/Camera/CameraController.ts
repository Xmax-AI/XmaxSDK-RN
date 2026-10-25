//
//  CameraController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { PermissionManaging } from '../../Foundation/Permissions/PermissionManaging';
import type { RenderControlling } from '../../Render/RenderControlling';
import type { MediaServicing } from '../../Service/Media/MediaServicing';
import type { CameraControlling } from './CameraControlling';
import { cameraPresetSize } from './CameraPreset';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import { ensureActive, abortable } from '../../Foundation/Runtime/Async';
import { invalid } from '../../Foundation/Errors/XmaxError';

import { refreshBinding } from '../../Render/Video/VideoRenderRegistry';
import { CameraPosition } from '../../Foundation/Media/Camera/CameraPosition';
import { realtimeModelSpecifications } from '../../Service/Realtime/RealtimeModel';
import { RealtimeMediaSource } from '../../Service/Media/RealtimeMediaSource';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type { CameraStreamOptions } from '../../Core/Realtime/RealtimeOperationOptions';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import { EncodingController } from '../../Stream/Encoding/EncodingController';
import { validateVideoFormat } from '../../Stream/Encoding/EncodingBitratePolicy';

/**
 * A controller that manages camera capture and updates the existing track when switching cameras.
 */
export class CameraController implements CameraControlling {

  /**
   * The currently held local camera stream.
   */
  stream: RealtimeMediaStream | null = null;

  /**
   * Whether the current camera stream publishes microphone audio.
   */
  useMicrophone = false;

  /**
   * Creates a camera controller sharing the RTC engine and rendering registry.
   *
   * @param rtc The RTC manager for media configuration and room events.
   * @param render The render controller for stream and video-track bindings.
   * @param media The shared model sizing and capability service.
   * @param permissions The camera and microphone authorization interface.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManaging,

    /**
     * The render controller for stream and video-track bindings.
     */
    private readonly render: RenderControlling,

    /**
     * The shared model sizing and capability service.
     */
    private readonly media: MediaServicing,

    /**
     * The camera and microphone authorization interface.
     */
    private readonly permissions: PermissionManaging,
  ) {}

  /**
   * Requests camera permission, configures encoding, and starts capture. The returned track is
   * owned by this controller.
   *
   * @param options The camera position, video format, microphone, and cancellation settings.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The camera stream after capture starts; its track must then be mounted to bind the
   *   preview.
   */
  async create(
    options: CameraStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    if (this.stream)
      throw invalid(
        'Stop the current local camera stream before creating a new one',
      );

    if (options.videoFormat !== undefined && options.preset !== undefined)
      throw invalid('Specify either videoFormat or preset');
    const spec = realtimeModelSpecifications[this.media.model];
    const presetSize =
      options.preset !== undefined ? cameraPresetSize(options.preset) : null;
    const requested =
      options.videoFormat ??
      (presetSize
        ? spec.supportedVideoFormats.find(
            format =>
              format.width === presetSize.width &&
              format.height === presetSize.height,
          )
        : spec.defaultCameraVideoFormat);
    if (!requested)
      throw invalid('Camera preset is not supported by this model');
    const position = options.position ?? CameraPosition.front;

    validateVideoFormat(requested);
    const format = Object.freeze({
      ...requested,
      ...this.media.resolveMediaSize(
        requested,
        RealtimeMediaSource.camera
      ),
    });
    const bitrates = EncodingController.bitrates(format);

    if (!Object.values(CameraPosition).includes(position))
      throw invalid('Invalid camera position');

    await abortable(
      this.permissions.ensureCameraPermission(),
      signal
    );
    ensureActive(signal);
    if (options.useMicrophone)
      await abortable(
        this.permissions.ensureMicrophonePermission(),
        signal
      );
    ensureActive(signal);

    try {
      await this.rtc.open(signal);
      ensureActive(signal);

      await this.rtc.configureEncoding(
        format,
        bitrates.minimum,
        bitrates.maximum,
      );
      ensureActive(signal);
      await this.rtc.startCamera(
        format,
        position,
        signal
      );
      ensureActive(signal);
      this.useMicrophone = options.useMicrophone ?? false;
      this.stream = this.render.create(
        true,
        format,
        position
      );

      return this.stream;
    } catch (error) {
      await this.rtc.close();
      throw error;
    }
  }

  /**
   * Switches the camera position and updates the existing local track binding.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The original local stream with its camera position updated.
   */
  async switch(
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (!this.stream) throw invalid('Create a local camera stream first');

    const binding = this.render.requireLocal(this.stream);
    const position =
      binding.position === CameraPosition.front
        ? CameraPosition.back
        : CameraPosition.front;

    await this.rtc.switchCamera(position);
    ensureActive(signal);
    binding.position = position;
    refreshBinding(binding);

    return this.stream;
  }

  /**
   * Updates camera capture and encoding in place while preserving the stream, track, and preview
   * binding.
   *
   * @param requested The target media format; dimensions must match a format supported by the
   *   model.
   * @param signal The operation's cancellation signal.
   */
  async updateVideoFormat(
    requested: RealtimeVideoFormat,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.stream) throw invalid('Create a local camera stream first');
    const binding = this.render.requireLocal(this.stream);
    validateVideoFormat(requested);
    const format = Object.freeze({
      ...requested,
      ...this.media.resolveMediaSize(
        requested,
        RealtimeMediaSource.camera
      ),
    });
    const bitrates = EncodingController.bitrates(format);
    ensureActive(signal);

    await this.rtc.updateCameraFormat(
      format,
      bitrates.minimum,
      bitrates.maximum,
    );
    if (signal.aborted && binding.valid) {
      // If cancellation occurs after native configuration succeeds, restores the previous media format before reporting cancellation.
      const previous = binding.format;
      const budget = EncodingController.bitrates(previous);
      try {
        await this.rtc.updateCameraFormat(
          previous,
          budget.minimum,
          budget.maximum,
        );
      } catch (error) {
        await this.close();
        throw error;
      }
    }
    ensureActive(signal);
    if (!binding.valid) throw invalid('Camera stream is no longer active');
    binding.format = format;
    refreshBinding(binding);
  }

  /**
   * Invalidates the camera track and releases native camera and RTC resources.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  async close(): Promise<void> {
    this.stream = null;
    this.useMicrophone = false;
    this.render.invalidate(true);
    await this.rtc.close();
  }
}
