//
//  TrajectorySampler.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { monotonicTime } from '../../Foundation/Runtime/MonotonicTime';
import {
  displayedFrame,
  type InteractionPoint,
  type InteractionFrame,
} from '../../Media/Interaction/InteractionCoordinateMapper';
import type {
  MediaSize,
  VideoContentMode,
} from '../../Service/Realtime/RealtimeTypes';
import type {
  TrajectoryEffectRendering,
  TrajectoryPoint,
} from './TrajectoryEffectRendering';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';

/**
 * A copied native touch position retained before the React event is released.
 */
export interface TrajectoryTouch extends InteractionPoint {

  /**
   * The native identifier stable for one touch contact.
   */
  readonly identifier: string;
}

/**
 * A multitouch sampler shared by video views that samples stationary touches at 30 Hz.
 */
export class TrajectorySampler {

  /**
   * The active touch identifiers and their latest sampled positions.
   */
  private readonly touches = new Map<string, TrajectoryPoint>();

  /**
   * The counter allocating trajectory identifiers for this sampler.
   */
  private nextID = 0;

  /**
   * The periodic sampling timer.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether the sampler has been permanently detached.
   */
  private disposed = false;

  /**
   * The gesture revision used to reject samples saved before gesture termination.
   */
  private generation = 0;

  /**
   * The displayed video rectangle after scaling.
   */
  private readonly frame;

  /**
   * Creates a sampler for video geometry, a renderer, and an interaction handler.
   *
   * @param viewport The viewport dimensions, in layout units.
   * @param video The video dimensions, in pixels.
   * @param mode The video fit or fill scaling mode.
   * @param renderer The trajectory renderer whose animations belong to this view.
   * @param submit The handler receiving interaction samples, without pixel buffers.
   */
  constructor(
    /**
     * The viewport dimensions, in layout units.
     */
    private readonly viewport: MediaSize,
    video: MediaSize,

    /**
     * The video fit or fill scaling mode.
     */
    private readonly mode: VideoContentMode,

    /**
     * The trajectory renderer whose animations belong to this view.
     */
    private readonly renderer: TrajectoryEffectRendering,

    /**
     * The handler receiving interaction samples, without pixel buffers.
     *
     * @param frame The sampled touches and their viewport positions.
     */
    private readonly submit: (
      frame: InteractionFrame
    ) => void,
  ) {
    this.frame = displayedFrame(
      viewport,
      video,
      mode
    );
  }

  /**
   * Checks whether a viewport position lies within the visible video.
   *
   * @param point The position to test or convert in the method's coordinate space.
   * @returns Whether the sampler is active and the point lies within visible video.
   */
  contains(
    point: InteractionPoint
  ): boolean {
    const frame = this.frame;

    return (
      !this.disposed &&
      !!frame &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= Math.max(0, frame.x) &&
      point.y >= Math.max(0, frame.y) &&
      point.x <= Math.min(this.viewport.width, frame.x + frame.width) &&
      point.y <= Math.min(this.viewport.height, frame.y + frame.height)
    );
  }

  /**
   * Accepts a new touch within video and starts periodic sampling.
   *
   * @param touches The touch sample with a stable native identifier.
   */
  begin(
    touches: readonly TrajectoryTouch[]
  ): void {
    const began: TrajectoryPoint[] = [];
    for (const touch of touches) {
      if (this.touches.has(touch.identifier) || !this.contains(touch)) continue;
      const point = this.point(
        touch,
        `trajectory-${++this.nextID}`
      );
      this.touches.set(
        touch.identifier,
        point
      );
      began.push(point);
    }
    if (!began.length) return;

    this.render(() => this.renderer.renderBegan(began));
    this.sample();
    this.timer ??= setInterval(
      () => this.sample(),
      1000 / 30
    );
  }

  /**
   * Updates touch positions and notifies the renderer after the movement threshold.
   *
   * @param touches The touch sample with a stable native identifier.
   */
  move(
    touches: readonly TrajectoryTouch[]
  ): void {
    if (this.disposed) return;
    const moved: TrajectoryPoint[] = [];
    for (const touch of touches) {
      const previous = this.touches.get(touch.identifier);
      if (!previous || !Number.isFinite(touch.x) || !Number.isFinite(touch.y))
        continue;
      const point = this.point(
        touch,
        previous.id
      );
      const dx = point.location.x - previous.location.x,
        dy = point.location.y - previous.location.y;
      if (dx * dx + dy * dy < 0.25) continue;
      this.touches.set(
        touch.identifier,
        point
      );
      moved.push(point);
    }
    if (moved.length) this.render(() => this.renderer.renderMoved(moved));
  }

  /**
   * Ends a touch and stops periodic sampling when none remain.
   *
   * @param identifiers The identifiers of the trajectories to end.
   */
  end(
    identifiers: readonly string[]
  ): void {
    const ended: string[] = [];
    for (const identifier of identifiers) {
      const point = this.touches.get(identifier);
      if (point) ended.push(point.id);
      this.touches.delete(identifier);
    }
    if (ended.length) {
      this.generation++;
      this.render(() => this.renderer.renderEnded(ended));
    }
    if (!this.touches.size) this.stopTimer();
  }

  /**
   * Reconciles active contacts against a complete snapshot, including missed end events.
   *
   * @param identifiers The identifiers of the trajectories to end.
   */
  retainTouches(
    identifiers: readonly string[]
  ): void {
    const active = new Set(identifiers);
    this.end([...this.touches.keys()].filter(id => !active.has(id)));
  }

  /**
   * Cancels the current gesture while allowing existing trails to fade naturally.
   */
  release(): void {
    this.end([...this.touches.keys()]);
  }

  /**
   * Cancels sampling on backgrounding, geometry or renderer changes, task replacement, or
   * unmounting.
   */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  /**
   * Cancels the current gesture while keeping this view reusable.
   */
  cancel(): void {
    this.release();
    this.stopTimer();
    this.render(() => this.renderer.reset());
  }

  /**
   * Clamps a touch to visible video and calculates normalized coordinates and monotonic time.
   *
   * @param touch The touch position reported by the view.
   * @param id The identifier of the trajectory.
   */
  private point(
    touch: TrajectoryTouch,
    id: string
  ): TrajectoryPoint {
    const frame = this.frame!;
    const x = Math.min(
      Math.max(touch.x, Math.max(0, frame.x)),
      Math.min(this.viewport.width, frame.x + frame.width),
    );
    const y = Math.min(
      Math.max(touch.y, Math.max(0, frame.y)),
      Math.min(this.viewport.height, frame.y + frame.height),
    );

    return {
      id,
      location: { x, y },
      normalizedLocation: {
        x: (x - frame.x) / frame.width,
        y: (y - frame.y) / frame.height,
      },
      timestamp: monotonicTime(),
    };
  }

  /**
   * Submits active touch positions and rejects samples from retired gestures.
   */
  private sample(): void {
    if (this.disposed || !this.touches.size) return;
    const generation = this.generation;
    this.submit({
      isCurrent: () => !this.disposed && generation === this.generation,
      points: [...this.touches.values()].map(point => point.location),
      viewportSize: this.viewport,
      contentMode: this.mode,
    });
  }

  /**
   * Cancels periodic sampling and clears its timer reference.
   */
  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Invokes visual callbacks without propagating custom-renderer exceptions.
   *
   * @param action The work performed under this operation's cancellation and ownership lease.
   */
  private render(
    action: () => void
  ): void {
    try {
      action();
    } catch {
      XmaxLogger.interaction.warn('Trajectory renderer callback failed');
    }
  }
}
