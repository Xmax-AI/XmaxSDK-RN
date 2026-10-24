//
//  MediaController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraControlling } from './Camera/CameraControlling';
import type { ImageControlling } from './Image/ImageControlling';
import type { InteractionControlling } from './Interaction/InteractionControlling';
import type { InteractionFrame } from './Interaction/InteractionCoordinateMapper';
import type { MediaControlling } from './MediaControlling';

import { invalid } from '../Foundation/Errors/XmaxError';

import type {
  CameraStreamOptions,
  ImageStreamOptions,
  RealtimeMediaStream,
  RealtimeVideoFormat,
} from '../Service/Realtime/RealtimeTypes';

/**
 * Coordinates local media ownership, preparation, and task interactions.
 */
export class MediaController implements MediaControlling {

  /**
   * The current local input type.
   */
  source: 'camera' | 'image' | null = null;

  /**
   * Creates a local media owner with camera, image, and interaction controllers.
   */
  constructor(
    /**
     * The camera capture and release controller.
     */
    private readonly camera: CameraControlling,

    /**
     * The image preparation and frame delivery controller.
     */
    private readonly image: ImageControlling,

    /**
     * The interaction controller for this owner's active generation task.
     */
    private readonly interaction: InteractionControlling,
  ) {}

  /**
   * The current touch sampling revision.
   */
  get generation(): number {
    return this.interaction.generation;
  }

  /**
   * Whether the current task accepts touch samples.
   */
  get isActive(): boolean {
    return this.interaction.isActive;
  }

  /**
   * Registers an interaction state callback and returns an unsubscribe function.
   *
   * @param listener The callback receiving task or sampling revision changes.
   * @returns The function that removes this subscription.
   */
  subscribe = (listener: () => void): (() => void) =>
    this.interaction.subscribe(listener);

  /**
   * Starts interaction mapping after generation is confirmed.
   *
   * @param taskID The confirmed generation task identifier.
   * @param videoFormat The original input dimensions and frame rate used for touch mapping.
   */
  startInteraction(
    taskID: string,
    videoFormat: RealtimeVideoFormat
  ): void {
    this.interaction.startInteraction(
      taskID,
      videoFormat
    );
  }

  /**
   * Cancels pending touch samples without releasing local media.
   */
  stopInteraction(): void {
    this.interaction.stopInteraction();
  }

  /**
   * Submits viewport samples for the current task and gesture revision.
   *
   * @param frame The sampled touch positions, viewport, scaling mode, and validity check.
   * @param generation The sampling revision accepting this frame.
   */
  submitInteraction(
    frame: InteractionFrame,
    generation: number
  ): void {
    this.interaction.submitInteraction(
      frame,
      generation
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
