//
//  TrajectoryEffectRendering.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ReactElement } from 'react';
import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';

/**
 * An identifier stable throughout one touch, ending on release or cancellation.
 */
export type TrajectoryID = string;

/**
 * A touch sample with viewport and normalized media coordinates.
 */
export interface TrajectoryPoint {

  /**
   * The identifier of the touch represented by this trajectory point.
   */
  readonly id: TrajectoryID;

  /**
   * The touch position in viewport layout units.
   */
  readonly location: InteractionPoint;

  /**
   * The touch position normalized to the full video, from 0 to 1.
   */
  readonly normalizedLocation: InteractionPoint;

  /**
   * The sample time, in monotonic seconds.
   */
  readonly timestamp: number;
}

/**
 * An interface for custom trajectory effects.
 *
 * The renderer controls appearance only. XmaxSDK retains touch capture, mapping, sampling, and
 * signaling; replacing the renderer does not affect tracks messages. Use one instance per mounted
 * view.
 */
export interface TrajectoryEffectRendering {

  /**
   * Passive React content over video; XmaxSDK retains touch handling.
   */
  readonly view: ReactElement;

  /**
   * Begins visual feedback for a trajectory; XmaxSDK continues to own sampling and messaging.
   *
   * @param points The trajectory samples with viewport positions and normalized media coordinates.
   */
  renderBegan(
    points: readonly TrajectoryPoint[]
  ): void;

  /**
   * Moves a trajectory effect to the latest touch position.
   *
   * @param points The trajectory samples with viewport positions and normalized media coordinates.
   */
  renderMoved(
    points: readonly TrajectoryPoint[]
  ): void;

  /**
   * Ends a trajectory's visual effect while preserving other active touches.
   *
   * @param identifiers The identifiers of the trajectories to end.
   */
  renderEnded(
    identifiers: readonly TrajectoryID[]
  ): void;

  /**
   * Releases animation resources and clears trajectories while remaining reusable.
   */
  reset(): void;
}
