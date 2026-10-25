//
//  RtcVideoSurface.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { findNodeHandle, View, StyleSheet } from 'react-native';
import { XmaxLogger } from '../Logging/XmaxLogger';
import NativeRuntime from '../Native/NativeXmaxRuntime';
import { monotonicTime } from '../Runtime/MonotonicTime';

/**
 * The maximum wait for Fabric to publish a native video container, in seconds.
 */
const mountTimeout = 5;

/**
 * An RTC canvas hosted in a Fabric view without passing video pixels to JS.
 *
 * @param props The container mount identity and registration handlers.
 */
export function RtcVideoSurface(
  {
    viewID,
    onLoad,
    onError,
  }: {

    /**
     * The unique native identity of the mounted container.
     */
    viewID: string;

    /**
     * The native container registration completion handler.
     */
    onLoad: () => void;

    /**
     * The native container registration failure handler.
     *
     * @param error The failure reported by the operation.
     */
    onError: (
      error: unknown
    ) => void;
  }
) {
  const host = useRef<ComponentRef<typeof View>>(null);
  const callback = useRef(onLoad);
  const failure = useRef(onError);
  callback.current = onLoad;
  failure.current = onError;
  useLayoutEffect(
    () => {
      let mounted = true;
      let frame: number | null = null;
      const deadline = monotonicTime() + mountTimeout;

      /**
       * Reports a terminal registration failure while this canvas remains active.
       *
       * @param error The registration failure or expired mount wait.
       */
      const fail = (error: unknown) => {
        if (!mounted) return;
        XmaxLogger.render.error(
          XmaxLogger.localized(
            '无法注册原生视频画布',
            'Unable to register native video canvas',
          ),
        );
        failure.current(error);
      };

      /**
       * Defers an unavailable canvas until the next frame within the mount deadline.
       */
      const waitForMount = () => {
        if (!mounted) return;
        if (monotonicTime() >= deadline) {
          fail(
            new Error('Timed out waiting for the native video canvas to mount'),
          );
          return;
        }
        frame = requestAnimationFrame(register);
      };

      /**
       * Registers the current host, retrying only when Fabric has not published it yet.
       */
      const register = async () => {
        frame = null;
        if (!mounted) return;
        const tag = findNodeHandle(host.current);
        if (typeof tag !== 'number') {
          waitForMount();
          return;
        }

        try {
          await NativeRuntime.registerVideoSurface(
            tag,
            viewID
          );
        } catch (error) {
          if (!mounted) return;
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'VIEW_NOT_MOUNTED'
          )
            waitForMount();
          else fail(error);
          return;
        }
        if (mounted) callback.current();
      };

      waitForMount();
      return () => {
        mounted = false;
        if (frame !== null) cancelAnimationFrame(frame);
        NativeRuntime.unregisterVideoSurface(viewID);
      };
    },
    [viewID]
  );
  return (
    <View
      ref={host}
      nativeID={viewID}
      collapsable={false}
      style={StyleSheet.absoluteFill}
    />
  );
}
