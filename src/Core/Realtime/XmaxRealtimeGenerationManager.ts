//
//  XmaxRealtimeGenerationManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionController } from '../../Media/Interaction/InteractionController';
import { invalid } from '../../Foundation/Errors/XmaxError';
import { ensureActive } from '../../Foundation/Runtime/Async';
import { taskIDFromUUID } from '../../Foundation/Runtime/RuntimeInfo';
import type { GenerationParameters } from '../../Stream/Room/RoomEvent';
import type { RtcManager, RemoteStream } from '../../Foundation/RTC/RtcManager';
import type {
  RealtimeContext,
  RealtimeVideoFormat,
} from '../../Service/Realtime/RealtimeTypes';
import type { StreamController } from '../../Stream/StreamController';

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
    private readonly rtc: RtcManager,

    /**
     * The stream controller.
     */
    private readonly stream: StreamController,

    /**
     * The interaction controller for the active task.
     */
    private readonly interaction: InteractionController,
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
   * @returns The confirmed remote account for a new task, or null for a condition update.
   */
  async start(
    format: RealtimeVideoFormat,
    context: RealtimeContext | null | undefined,
    signal: AbortSignal,
    options: GenerationParameters = {},
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
      this.interaction.startInteraction(
        this.taskID,
        format
      );
      await this.stream.updateGeneration(
        this.taskID,
        format,
        resolved,
        options,
      );
      ensureActive(signal);

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
      format,
      resolved,
      signal,
      options,
    );
    ensureActive(signal);
    this.context = resolved;
    this.interaction.startInteraction(
      taskID,
      format
    );
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
    targetSize: import('../../Service/Realtime/RealtimeTypes').MediaSize,
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
