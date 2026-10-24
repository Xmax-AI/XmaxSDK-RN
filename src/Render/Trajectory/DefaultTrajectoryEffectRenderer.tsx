//
//  DefaultTrajectoryEffectRenderer.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { findNodeHandle, StyleSheet, View } from 'react-native';
import NativeRuntime from '../../Foundation/Native/NativeXmaxRuntime';
import type {
  TrajectoryEffectRendering,
  TrajectoryID,
  TrajectoryPoint,
} from './TrajectoryEffectRendering';

/**
 * The trajectory core and halo colors.
 */
interface Colors {

  /**
   * The trajectory core color as a CSS color string.
   */
  core: string;

  /**
   * The trajectory halo color as a CSS color string.
   */
  glow: string;
}

/**
 * A trajectory identity and viewport position sent to native rendering.
 */
interface NativePoint extends Colors {

  /**
   * The identifier of the touch represented by this trajectory point.
   */
  id: string;

  /**
   * The horizontal coordinate in the enclosing position's coordinate space.
   */
  x: number;

  /**
   * The vertical coordinate in the enclosing position's coordinate space.
   */
  y: number;
}

/**
 * A drawing operation for a mounted native trajectory layer.
 */
type Command =
  | {

      /**
       * The native drawing command type.
       */
      action: 'begin' | 'move';

      /**
       * The current native point for each active trajectory.
       */
      points: readonly NativePoint[];
    }
  | {

      /**
       * The native drawing command type.
       */
      action: 'end';

      /**
       * The trajectory identifiers affected by this command.
       */
      ids: readonly string[];
    }
  | {

      /**
       * The native drawing command type.
       */
      action: 'reset' | 'detach';
    };

/**
 * The counter used to allocate native trajectory mount identities.
 */
let nextViewID = 0;

/**
 * A native renderer for trajectory trails and pulsing touch halos. Touch updates cross the bridge;
 * animation runs on the native display loop. Override colorsForTrajectory to customize colors.
 */
export class DefaultTrajectoryEffectRenderer
  implements TrajectoryEffectRendering
{

  /**
   * A passive overlay that leaves interaction handling to XmaxSDK.
   */
  readonly view = (<TrajectoryEffectView renderer={this} />);

  /**
   * The current native point for each active trajectory.
   */
  private readonly points = new Map<TrajectoryID, NativePoint>();

  /**
   * The drawing command receiver for the mounted native view.
   */
  private send: ((
    command: Command
  ) => void) | null = null;

  /**
   * Selects colors for a new touch without changing sampling or message delivery.
   *
   * @param _id The trajectory identifier; default colors do not depend on it.
   */
  protected colorsForTrajectory(
    _id: TrajectoryID
  ): Colors {
    return { core: '#FFFFFF', glow: '#00FF64' };
  }

  /**
   * Begins visual feedback for a trajectory; XmaxSDK continues to own sampling and messaging.
   *
   * @param points The trajectory samples with viewport positions and normalized media coordinates.
   */
  renderBegan(
    points: readonly TrajectoryPoint[]
  ): void {
    const began = points.map(point => {
      const value = {
        id: point.id,
        x: point.location.x,
        y: point.location.y,
        ...this.colorsForTrajectory(point.id),
      };
      this.points.set(
        point.id,
        value
      );
      return value;
    });
    if (began.length) this.send?.({ action: 'begin', points: began });
  }

  /**
   * Moves a trajectory effect to the latest touch position.
   *
   * @param points The trajectory samples with viewport positions and normalized media coordinates.
   */
  renderMoved(
    points: readonly TrajectoryPoint[]
  ): void {
    const moved: NativePoint[] = [];
    for (const point of points) {
      const previous = this.points.get(point.id);
      if (!previous) continue;
      const value = { ...previous, x: point.location.x, y: point.location.y };
      this.points.set(
        point.id,
        value
      );
      moved.push(value);
    }
    if (moved.length) this.send?.({ action: 'move', points: moved });
  }

  /**
   * Ends a trajectory's visual effect while preserving other active touches.
   *
   * @param identifiers The identifiers of the trajectories to end.
   */
  renderEnded(
    identifiers: readonly TrajectoryID[]
  ): void {
    for (const id of identifiers) this.points.delete(id);
    this.send?.({ action: 'end', ids: identifiers });
  }

  /**
   * Clears active touches and resets the native layer for reuse.
   */
  reset(): void {
    this.points.clear();
    this.send?.({ action: 'reset' });
  }

  /**
   * Attaches the native canvas and retains updates arriving before attachment.
   *
   * @param send The handler that submits encoded messages or interaction samples.
   * @returns The function that removes observation or the native drawing receiver.
   */
  attach(
    send: (
      command: Command
    ) => void
  ): () => void {
    this.send?.({ action: 'detach' });
    this.send = send;
    send({ action: 'reset' });
    if (this.points.size)
      send({ action: 'begin', points: [...this.points.values()] });

    return () => {
      if (this.send !== send) return;
      send({ action: 'detach' });
      this.send = null;
      this.points.clear();
    };
  }
}

/**
 * Hosts the native trajectory canvas in a stable, noncollapsible container.
 *
 * @param props A renderer for trajectory effects.
 */
function TrajectoryEffectView(
  {
    renderer,
  }: {

    /**
     * The renderer associated with this mounted trajectory view.
     */
    renderer: DefaultTrajectoryEffectRenderer;
  }
) {
  const host = useRef<ComponentRef<typeof View>>(null);
  const [nativeID] = useState(() => `xmax-trajectory-${++nextViewID}`);
  useLayoutEffect(
    () => {
      const tag = findNodeHandle(host.current);
      if (typeof tag !== 'number') return;
      return renderer.attach(command =>
        NativeRuntime.renderTrajectory(
          tag,
          nativeID,
          JSON.stringify(command)
        ),
      );
    },
    [renderer, nativeID]
  );

  return (
    <View
      ref={host}
      nativeID={nativeID}
      collapsable={false}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );
}
