//
//  ExternalVideoController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ExternalVideoControlling } from './ExternalVideoControlling';
import type {
  RealtimeExternalVideoSource,
  RealtimeExternalFrameSink,
} from './RealtimeExternalVideoSource';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RenderControlling } from '../../Render/RenderControlling';
import type { MediaServicing } from '../../Service/Media/MediaServicing';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';
import { RealtimeMediaSource } from '../../Service/Media/RealtimeMediaSource';
import { EncodingController } from '../../Stream/Encoding/EncodingController';
import { abortable, ensureActive } from '../../Foundation/Runtime/Async';
import {
  invalid,
  XmaxError,
  XmaxErrorCode,
} from '../../Foundation/Errors/XmaxError';

/**
 * Owns an external source attachment, native sink identity, and preview binding.
 */
export class ExternalVideoController implements ExternalVideoControlling {

  /**
   * The current external input stream.
   */
  stream: RealtimeMediaStream | null = null;

  /**
   * Whether the attached source supplies audio.
   */
  hasAudio = false;

  /**
   * The source retained until its producer stops.
   */
  private source: RealtimeExternalVideoSource | null = null;

  /**
   * The sink invalidation action for the current attachment.
   */
  private invalidate: (() => void) | null = null;

  /**
   * Creates an external input controller.
   */
  constructor(
    /**
     * The exclusively leased RTC and native media resources.
     */
    private readonly rtc: RtcManaging,

    /**
     * The owner of preview bindings and stream identities.
     */
    private readonly render: RenderControlling,

    /**
     * The model sizing and capability service.
     */
    private readonly media: MediaServicing,

    /**
     * The unrecoverable source failure handler.
     *
     * @param error The normalized external media failure.
     */
    private readonly failure: (
      error: XmaxError
    ) => void,
  ) {}

  /**
   * Resolves source dimensions and starts native frame ingress before app-owned capture.
   *
   * @param source The source supplying native video and optional PCM audio.
   * @param signal The operation's cancellation signal.
   * @returns The attached local stream after source startup.
   */
  async create(
    source: RealtimeExternalVideoSource,
    signal: AbortSignal,
  ): Promise<RealtimeMediaStream> {
    if (
      this.source ||
      !source ||
      typeof source.start !== 'function' ||
      typeof source.stop !== 'function'
    )
      throw invalid('An unattached external video source is required');
    const input = { ...source.videoFormat };
    if (
      !Number.isSafeInteger(input.fps) ||
      input.fps <= 0 ||
      input.fps > 2147483647 ||
      (source.hasAudio !== undefined && typeof source.hasAudio !== 'boolean')
    )
      throw invalid('Invalid external source format or audio declaration');
    const format = Object.freeze({
      ...input,
      ...this.media.resolveMediaSize(
        input,
        RealtimeMediaSource.external
      ),
    });
    const bitrates = EncodingController.bitrates(format);
    ensureActive(signal);
    let active = true;
    this.invalidate = () => {
      active = false;
    };
    this.source = source;
    this.hasAudio = source.hasAudio ?? false;
    const sink: RealtimeExternalFrameSink = Object.freeze({
      nativeHandle: this.rtc.randomUUID(),
      videoFormat: format,
      /**
       * Whether the attachment still accepts native frames.
       */
      get isRequestingFrames() {
        return active;
      },
      /**
       * Terminates this attachment on its first unrecoverable source failure.
       *
       * @param error The source failure.
       */
      reportError: (error: unknown) => {
        if (!active) return;
        active = false;
        this.failure(
          new XmaxError({
            code: XmaxErrorCode.mediaError,
            message: XmaxError.from(error).message,
          }),
        );
      },
    });
    try {
      await this.rtc.open(signal);
      ensureActive(signal);
      await this.rtc.startExternalSource(
        sink.nativeHandle,
        input,
        format,
        this.hasAudio,
      );
      await this.rtc.configureEncoding(
        format,
        bitrates.minimum,
        bitrates.maximum,
      );
      ensureActive(signal);
      this.stream = this.render.create(
        true,
        format,
        null
      );
      const starting = Promise.resolve().then(() => source.start(sink));
      void starting
        .then(async () => {
          if (!active) await source.stop();
        })
        .catch(() => {});
      await abortable(
        starting,
        signal
      );
      ensureActive(signal);
      if (!active) throw invalid('External source stopped during startup');
      return this.stream;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Rejects further frames before stopping the source and releasing native input resources.
   */
  async close(): Promise<void> {
    this.invalidate?.();
    this.invalidate = null;
    const source = this.source;
    this.source = null;
    this.stream = null;
    this.hasAudio = false;
    this.render.invalidate(true);
    try {
      await this.rtc.close();
    } finally {
      await source?.stop();
    }
  }
}
