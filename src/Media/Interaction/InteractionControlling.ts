//
//  InteractionControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeTypes';
import type { InteractionFrame } from './InteractionCoordinateMapper';

/**
 * An interface for task interaction mapping, sampling validity, and delivery.
 */
export interface InteractionControlling {

  /**
   * The current sample revision used to reject touch input from ended tasks.
   *
   * @returns The current monotonically increasing touch revision.
   */
  readonly generation: number;

  /**
   * Whether an active generation task accepts touch samples.
   *
   * @returns Whether the resource owner or current task remains active.
   */
  readonly isActive: boolean;

  /**
   * Registers a touch state callback and returns an unsubscribe function.
   *
   * @param listener The callback invoked when the active task or touch revision changes.
   * @returns The function that removes observation or the native drawing receiver.
   */
  readonly subscribe: (
    listener: () => void
  ) => () => void;

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
  ): void;

  /**
   * Cancels pending samples immediately without waiting for other disconnect cleanup.
   */
  stopInteraction(): void;

  /**
   * Accepts touch frames only for the current task and sample revision.
   *
   * @param frame The viewport geometry, touch points, and gesture validity check.
   * @param generation The touch revision used to reject samples from a previous task or gesture.
   */
  submitInteraction(
    frame: InteractionFrame,
    generation: number
  ): void;
}
