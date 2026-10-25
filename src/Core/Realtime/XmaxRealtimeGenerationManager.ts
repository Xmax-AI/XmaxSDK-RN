//
//  XmaxRealtimeGenerationManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RenderControlling } from '../../Render/RenderControlling';
import type { RealtimeTiming } from '../../Service/Realtime/RealtimeTiming';
import type { InteractionControlling } from '../../Media/Interaction/InteractionControlling';
import { invalid } from '../../Foundation/Errors/XmaxError';
import { ensureActive } from '../../Foundation/Runtime/Async';
import { taskIDFromUUID } from '../../Foundation/Runtime/RuntimeInfo';
import type { GenerationParameters } from '../../Stream/Room/RoomEvent';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RemoteStream } from '../../Foundation/RTC/RemoteStream';
import type { RealtimeContext } from '../../Service/Realtime/RealtimeContext';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type { StreamControlling } from '../../Stream/StreamControlling';

/**
 * Coordinates generation signaling, remote stream confirmation, condition updates, and
 * interactions.
 */
export class XmaxRealtimeGenerationManager {

  /**
   * The active generation task identifier.
   */
  taskID: string | null = null;

  /**
   * The generation prompt and reference image location.
   */
  private context: RealtimeContext | null = null;

  /**
   * Creates a generation manager.
   */
  constructor(
    /**
     * The RTC manager for media configuration and room events.
     */
    private readonly rtc: RtcManaging,

    /**
     * The stream controller.
     */
    private readonly stream: StreamControlling,

    /**
     * The interaction controller for the active task.
     */
    private readonly interaction: InteractionControlling,

    /**
     * The controller observing decoded result frame readiness.
     */
    private readonly render: RenderControlling,

    /**
     * The shared startup timing measurement.
     */
    private readonly timing?: RealtimeTiming,
  ) {}

  /**
   * Validates generation conditions before connection or task updates.
   *
   * @param context The prompt and reference image location; reusable operations retain the last
   *   successful conditions when omitted.
   */
  validateContext(
    context: RealtimeContext | null | undefined
  ): void {
    if (!context && !this.context)
      throw invalid('A realtime context is required for the first generation');
  }

  /**
   * Starts or updates generation and caches conditions only after successful, valid completion.
   *
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param context The prompt and reference image location; reusable operations retain the last
   *   successful conditions when omitted.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @param options The returned dimensions, face restoration, and input-containment settings.
   * @param generationVideoFormat The server canvas format; defaults to the local media format.
   * @returns The remote account after first-frame readiness and audio activation, or null for a
   *   condition update.
   */
  async start(
    format: RealtimeVideoFormat,
    context: RealtimeContext | null | undefined,
    signal: AbortSignal,
    options: GenerationParameters = {},
    generationVideoFormat: RealtimeVideoFormat = format,
  ): Promise<RemoteStream | null> {
    const resolved = context
      ? {
          prompt: context.prompt.trim(),
          referencePath: context.referencePath?.trim() || null,
        }
      : this.context;

    if (!resolved)
      throw invalid('A realtime context is required for the first generation');

    ensureActive(signal);
    if (this.taskID) {
      await this.stream.updateGeneration(
        this.taskID,
        generationVideoFormat,
        resolved,
        options,
      );
      ensureActive(signal);

      this.interaction.startInteraction(
        this.taskID,
        format
      );
      this.context = resolved;

      return null;
    }

    const taskID = taskIDFromUUID(
      this.rtc.randomUUID(),
      this.rtc.runtime.platform,
    );

    this.taskID = taskID;

    // Keep the task until coordinated cleanup hides the result and sends its stop signal.
    const remote = await this.stream.beginGeneration(
      taskID,
      generationVideoFormat,
      resolved,
      signal,
      options,
    );
    ensureActive(signal);
    this.interaction.startInteraction(
      taskID,
      format
    );
    await this.render.waitUntilRemoteFrameReady(
      remote,
      signal
    );
    ensureActive(signal);
    this.timing?.finishFirstFrame(taskID);
    await this.stream.activateRemoteAudio(remote);
    ensureActive(signal);
    this.context = resolved;
    return remote;
  }

  /**
   * Updates returned dimensions while preserving the task and cached conditions.
   *
   * Completes after submitting the size signal; no signal is sent without an active task.
   *
   * @param targetSize The returned frame dimensions, in pixels.
   */
  async changeTargetSize(
    targetSize: import('../../Service/Realtime/RealtimeVideoFormat').MediaSize,
  ): Promise<void> {
    if (this.taskID)
      await this.stream.changeTargetSize(
        this.taskID,
        targetSize
      );
  }

  /**
   * Stops interaction delivery and sends a stop signal when a task exists.
   */
  async stop(): Promise<void> {
    this.interaction.stopInteraction();
    const taskID = this.taskID;

    this.taskID = null;
    if (taskID) await this.stream.stopGeneration(taskID);
  }

  /**
   * Stops generation and clears cached conditions.
   */
  async reset(): Promise<void> {
    this.context = null;
    await this.stop();
  }
}
