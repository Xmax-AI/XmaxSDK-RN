//
//  ImageController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaServicing } from '../../Service/Media/MediaServicing';
import type { ImageControlling } from './ImageControlling';
import type { ImageManaging } from '../../Foundation/Media/ImageManaging';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import { ensureActive } from '../../Foundation/Runtime/Async';
import { invalid } from '../../Foundation/Errors/XmaxError';
import type { RenderControlling } from '../../Render/RenderControlling';

import { realtimeModelSpecifications } from '../../Service/Realtime/RealtimeModel';
import { RealtimeMediaSource } from '../../Service/Media/RealtimeMediaSource';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import type { ImageStreamOptions } from '../../Core/Realtime/RealtimeOperationOptions';
import { EncodingController } from '../../Stream/Encoding/EncodingController';

/**
 * Coordinates image decoding, repeated frame delivery, and preview.
 *
 * The original file remains caller-owned; copies prepared after cancellation are deleted.
 */
export class ImageController implements ImageControlling {

  /**
   * The currently held local image stream.
   */
  stream: RealtimeMediaStream | null = null;

  /**
   * The URL of the SDK-owned image copy.
   */
  private fileURL: string | null = null;

  /**
   * Creates an image input controller for native image preparation and RTC frame submission.
   *
   * @param rtc The RTC manager for media configuration and room events.
   * @param render The render controller for stream and video-track bindings.
   * @param media The shared model sizing and capability service.
   * @param images The service managing image metadata, prepared copies, and copy cleanup.
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
     * The service for image metadata, copy preparation, and cache cleanup.
     */
    private readonly images: ImageManaging,
  ) {}

  /**
   * Prepares an upright private image copy and starts repeated native frame submission. Copies
   * completed after cancellation are removed.
   *
   * @param options The local image URL, encoding settings, frame rate, and cancellation signal;
   *   dimensions are resolved from the file.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @returns The local image stream after the native frame scheduler is ready.
   */
  async create(
    options: ImageStreamOptions,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    if (this.stream) throw invalid('Stop the current local image stream first');
    if (!options) throw invalid('Image stream options are required');

    let prepared: string | null = null;

    try {
      const size = await this.images.size(options.fileURL);

      ensureActive(signal);

      const requested = options.videoFormat;
      const fps =
        requested?.fps ??
        realtimeModelSpecifications[this.media.model].defaultFrameRate;

      if (!Number.isSafeInteger(fps) || fps <= 0)
        throw invalid('Image stream frame rate must be greater than zero');

      const format = {
        ...requested,
        ...this.media.resolveMediaSize(
          size,
          RealtimeMediaSource.image
        ),
        fps,
      };

      const bitrates = EncodingController.bitrates(format);
      prepared = await this.images.prepare(
        options.fileURL,
        format
      );
      ensureActive(signal);
      await this.rtc.open(signal);
      ensureActive(signal);

      await this.rtc.configureImageSource();
      await this.rtc.configureEncoding(
        format,
        bitrates.minimum,
        bitrates.maximum,
      );
      ensureActive(signal);
      // Decodes the copied file URL before passing its absolute path to native frame submission.
      await this.rtc.startImage(
        decodeURIComponent(prepared.slice('file://'.length)),
        format,
      );
      ensureActive(signal);
      this.stream = this.render.create(
        true,
        format,
        null,
        null,
        prepared
      );
      this.fileURL = prepared;

      return this.stream;
    } catch (error) {
      try {
        await this.rtc.close();
      } finally {
        if (prepared) await this.images.remove(prepared).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Stops native image frame submission, invalidates the local track, and deletes the copy.
   *
   * Completes after resource release; concurrent calls share cleanup.
   */
  async close(): Promise<void> {
    const fileURL = this.fileURL;

    this.fileURL = null;
    this.stream = null;
    this.render.invalidate(true);

    // Detaches the image source before deleting a file it may still be reading.
    try {
      await this.rtc.close();
    } finally {
      if (fileURL) await this.images.remove(fileURL);
    }
  }
}
