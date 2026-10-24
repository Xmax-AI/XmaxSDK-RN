//
//  TrajectoryOverlay.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from 'react';
import {
  AppState,
  View,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import type { VideoRenderBinding } from '../Video/VideoRenderBinding';
import type { VideoContentMode } from '../../Service/Realtime/RealtimeTypes';
import type { TrajectoryEffectRendering } from './TrajectoryEffectRendering';
import { DefaultTrajectoryEffectRenderer } from './DefaultTrajectoryEffectRenderer';
import { TrajectorySampler } from './TrajectorySampler';
import { trajectoryTouchPoint } from './TrajectoryTouchCoordinates';

/**
 * Installs passive rendering and SDK interaction handling for confirmed remote output.
 *
 * @param props The binding, scaling mode, and trajectory renderer.
 */
export function TrajectoryOverlay(
  {
    binding,
    contentMode,
    renderer: requested,
  }: {

    /**
     * The video track binding for this view.
     */
    binding: VideoRenderBinding;

    /**
     * The scaling mode mapping video into the viewport.
     */
    contentMode: VideoContentMode;

    /**
     * The renderer associated with this mounted trajectory view.
     */
    renderer?: TrajectoryEffectRendering | null | undefined;
  }
) {
  const interaction = binding.interaction!;
  const generation = useSyncExternalStore(
    interaction.subscribe,
    () => interaction.generation,
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      binding.listeners.add(listener);

      return () => {
        binding.listeners.delete(listener);
      };
    },
    [binding],
  );
  useSyncExternalStore(
    subscribe,
    () => binding.version
  );
  const fallback = useMemo(
    () => new DefaultTrajectoryEffectRenderer(),
    []
  );
  const renderer = requested ?? fallback;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sampler = useRef<TrajectorySampler | null>(null);
  const viewport = useRef<ComponentRef<typeof View>>(null);

  const touches = (event: GestureResponderEvent) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return [];
    return event.nativeEvent.changedTouches.flatMap(touch => {
      const point = trajectoryTouchPoint(
        touch,
        rect,
        size
      );
      return point ? [{ identifier: String(touch.identifier), ...point }] : [];
    });
  };

  const retainTouches = (event: GestureResponderEvent) => {
    sampler.current?.retainTouches(
      event.nativeEvent.touches.map(touch => String(touch.identifier)),
    );
  };

  useLayoutEffect(
    () => {
      if (
        !binding.valid ||
        !binding.confirmed ||
        !interaction.isActive ||
        !size.width ||
        !size.height
      )
        return;

      const current = new TrajectorySampler(
        size,
        binding.format,
        contentMode,
        renderer,
        frame => {
          if (binding.valid && binding.confirmed)
            interaction.submitInteraction(
              frame,
              generation
            );
        },
      );
      sampler.current = current;
      const subscription = AppState.addEventListener(
        'change',
        state => {
          if (state === 'background') {
            current.dispose();
            sampler.current = null;
          }
        }
      );

      return () => {
        subscription.remove();
        sampler.current = null;
        current.dispose();
      };
    },
    [
      binding,
      binding.valid,
      binding.confirmed,
      binding.format.width,
      binding.format.height,
      interaction,
      generation,
      contentMode,
      renderer,
      size,
    ]
  );

  return (
    <View
      ref={viewport}
      collapsable={false}
      pointerEvents="box-only"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        setSize(current =>
          current.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        )
      }
      onStartShouldSetResponder={event => {
        const rect = viewport.current?.getBoundingClientRect();
        const point =
          rect && trajectoryTouchPoint(
            event.nativeEvent,
            rect,
            size
          );
        return !!point && !!sampler.current?.contains(point);
      }}
      onResponderGrant={event => {
        // Each responder acquisition starts a new gesture even when native identifiers are reused.
        sampler.current?.release();
        sampler.current?.begin(touches(event));
      }}
      onResponderStart={event => {
        retainTouches(event);
        sampler.current?.begin(touches(event));
      }}
      onResponderMove={event => {
        retainTouches(event);
        sampler.current?.move(touches(event));
      }}
      onResponderEnd={event => {
        sampler.current?.end(
          event.nativeEvent.changedTouches.map(touch =>
            String(touch.identifier),
          ),
        );
        retainTouches(event);
      }}
      onResponderRelease={() => sampler.current?.release()}
      onResponderTerminationRequest={() => true}
      onResponderTerminate={() => sampler.current?.cancel()}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {renderer.view}
      </View>
    </View>
  );
}
