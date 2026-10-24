//
//  InteractionController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionControlling } from './InteractionControlling';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import {
  mapInteractionPoint,
  type InteractionFrame,
  type InteractionPoint,
} from './InteractionCoordinateMapper';

/**
 * A controller that manages touch messages for the current task, retaining only the latest pending
 * sample when sending is slower than sampling.
 */
export class InteractionController implements InteractionControlling {

  /**
   * The task identifier and original input format accepting touch samples.
   */
  private active: {

    /**
     * The active generation task identifier.
     */
    taskID: string;

    /**
     * The video dimensions, frame rate, and encoder bitrate settings.
     */
    format: RealtimeVideoFormat;
  } | null = null;

  /**
   * The latest pending sample and its gesture validity check.
   */
  private pending: {

    /**
     * The ordered points in the current gesture or drawing command.
     */
    points: readonly InteractionPoint[];

    /**
     * The check that determines whether a touch sample still belongs to the current task and
     * gesture.
     */
    isCurrent: (() => boolean) | undefined;
  } | null = null;

  /**
   * The revision of the touch sample currently being sent.
   */
  private draining: number | null = null;

  /**
   * The revision used to reject late asynchronous results.
   */
  private version = 0;

  /**
   * The subscribers to binding or resource changes.
   */
  private readonly listeners = new Set<() => void>();

  /**
   * Creates a task interaction controller. A sample delivery failure does not terminate generation.
   */
  constructor(
    /**
     * The function that sends a task identifier and normalized coordinates. A delivery failure does
     * not terminate generation.
     *
     * @param taskID The generation task accepting this sample.
     * @param points The normalized media touch coordinates, each from 0 to 1.
     * @returns Completes after sample submission; delivery failures are recoverable.
     */
    private readonly send: (
      taskID: string,
      points: readonly InteractionPoint[],
    ) => void | Promise<void>,
  ) {}

  /**
   * The current sample revision used to reject touch input from ended tasks.
   *
   * @returns The current monotonically increasing touch revision.
   */
  get generation(): number {
    return this.version;
  }

  /**
   * Whether an active generation task accepts touch samples.
   *
   * @returns Whether the resource owner or current task remains active.
   */
  get isActive(): boolean {
    return this.active !== null;
  }

  /**
   * Registers a touch state callback and returns an unsubscribe function.
   *
   * @param listener The callback invoked when the active task or touch revision changes.
   * @returns The function that removes observation or the native drawing receiver.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Starts accepting touch input only after task confirmation, replacing all samples from the
   * previous task.
   *
   * @param taskID The generation task identifier for signaling and interaction messages.
   * @param videoFormat The video dimensions and frame rate used for coordinate mapping, in pixels
   *   and fps.
   */
  startInteraction(
    taskID: string,
    videoFormat: RealtimeVideoFormat
  ): void {
    this.active = { taskID, format: { ...videoFormat } };
    this.invalidate();
  }

  /**
   * Cancels pending samples immediately without waiting for other disconnect cleanup.
   */
  stopInteraction(): void {
    this.active = null;
    this.invalidate();
  }

  /**
   * Accepts touch frames only for the current task and sample revision.
   *
   * @param frame The viewport geometry, touch points, and gesture validity check.
   * @param generation The touch revision used to reject samples from a previous task or gesture.
   */
  submitInteraction(
    frame: InteractionFrame,
    generation: number
  ): void {
    if (!this.active || generation !== this.version) return;

    const points = frame.points
      .map(point =>
        mapInteractionPoint(
          point,
          frame.viewportSize,
          this.active!.format,
          frame.contentMode,
        ),
      )
      .filter((point): point is InteractionPoint => point !== null);

    if (!points.length) return;
    this.pending = { points, isCurrent: frame.isCurrent };
    if (this.draining === generation) return;

    this.draining = generation;
    void this.drain(generation);
  }

  /**
   * Clears pending touch input and notifies subscribers that the sample revision changed.
   */
  private invalidate(): void {
    this.version++;
    this.pending = null;
    this.draining = null;
    for (const listener of this.listeners) listener();
  }

  /**
   * Sends only samples from the current revision and coalesces pending movement while sending.
   *
   * @param generation The touch revision used to reject samples from a previous task or gesture.
   */
  private async drain(
    generation: number
  ): Promise<void> {
    // Defers sending by one scheduling turn to coalesce samples from the same UI batch and avoid a message backlog.
    await Promise.resolve();
    while (generation === this.version && this.active && this.pending) {
      const sample = this.pending;
      this.pending = null;
      if (sample.isCurrent && !sample.isCurrent()) continue;
      try {
        await this.send(
          this.active.taskID,
          sample.points
        );
      } catch {
        XmaxLogger.interaction.warn(
          'Interaction sample delivery failed; sample dropped',
        );
      }
    }
    if (generation === this.version) this.draining = null;
  }
}
