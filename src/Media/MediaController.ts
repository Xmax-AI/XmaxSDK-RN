//
//  MediaController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcManager } from '../Foundation/RTC/RtcManager';
import { invalid } from '../Foundation/Errors/XmaxError';
import type { RenderController } from '../Render/RenderController';
import type {
  CameraStreamOptions,
  ImageStreamOptions,
  RealtimeMediaStream,
  RealtimeModel,
  RealtimeVideoFormat,
} from '../Service/Realtime/RealtimeTypes';
import { CameraController } from './Camera/CameraController';
import { ImageController } from './Image/ImageController';

/**
 * A controller that serializes ownership of a single local input, including pending preparation.
 */
export class MediaController {

  /**
   * The current local input type.
   */
  source: 'camera' | 'image' | null = null;

  /**
   * The controller for local camera capture and release.
   */
  private readonly camera: CameraController;

  /**
   * The controller for image preparation, frame submission, and cleanup.
   */
  private readonly image: ImageController;

  /**
   * Creates mutually exclusive camera and image input controllers for the current model.
   *
   * @param rtc The RTC manager for media configuration and room events.
   * @param render The render controller for stream and video-track bindings.
   * @param model The generation model defining media constraints and supported formats.
   */
  constructor(
    rtc: RtcManager,
    render: RenderController,
    model: RealtimeModel
  ) {
    this.camera = new CameraController(
      rtc,
      render,
      model
    );
    this.image = new ImageController(
      rtc,
      render,
      model
    );
  }

  /**
   * The currently held local stream.
   */
  get stream(): RealtimeMediaStream | null {
    return this.source === 'camera' ? this.camera.stream : this.image.stream;
  }

  /**
   * Whether the current local input requires microphone audio publication.
   */
  get useMicrophone(): boolean {
    return this.source === 'camera' && this.camera.useMicrophone;
  }

  /**
   * Creates a camera stream after verifying that no other local input is held.
   *
   * @param options The camera position, video format, microphone, and cancellation settings.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The manager-owned local camera stream.
   */
  createCamera(
    options: CameraStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    return this.create(
      'camera',
      () => this.camera.create(
        options,
        signal
      )
    );
  }

  /**
   * Creates an image stream after verifying that no other local input is held.
   *
   * @param options The local image URL, encoding settings, frame rate, and cancellation signal;
   *   dimensions are resolved from the file.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The manager-owned local image stream.
   */
  createImage(
    options: ImageStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    return this.create(
      'image',
      () => this.image.create(
        options,
        signal
      )
    );
  }

  /**
   * Prepares the specified input type and clears its ownership if preparation fails.
   *
   * @param source The local media source.
   * @param action The work performed under this operation's cancellation and ownership lease.
   */
  private async create(
    source: 'camera' | 'image',
    action: () => Promise<RealtimeMediaStream>,
  ): Promise<RealtimeMediaStream> {
    if (this.source)
      throw invalid(
        'Stop the current local stream before creating another one',
      );

    this.source = source;
    try {
      return await action();
    } catch (error) {
      this.source = null;
      throw error;
    }
  }

  /**
   * Switches the current camera; rejects when the input is an image or no camera is active.
   *
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The existing camera stream after switching.
   */
  switchCamera(
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (this.source !== 'camera')
      throw invalid('Create a local camera stream first');

    return this.camera.switch(signal);
  }

  /**
   * Updates the current camera format without replacing the media stream.
   *
   * @param format The target camera format.
   * @param signal The operation's cancellation signal.
   */
  async updateCameraFormat(
    format: RealtimeVideoFormat,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.source !== 'camera')
      throw invalid('Create a local camera stream first');
    try {
      await this.camera.updateVideoFormat(
        format,
        signal
      );
    } catch (error) {
      if (!this.camera.stream) this.source = null;
      throw error;
    }
  }

  /**
   * Releases the current local source only if its input type matches.
   *
   * @param source The local media source.
   */
  async stop(
    source: 'camera' | 'image'
  ): Promise<void> {
    if (this.source === source) await this.close();
  }

  /**
   * Releases the current local input and clears its ownership.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  async close(): Promise<void> {
    const source = this.source;

    this.source = null;
    if (source === 'camera') await this.camera.close();
    else if (source === 'image') await this.image.close();
  }
}
