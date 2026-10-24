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
      const tag = findNodeHandle(host.current);
      if (typeof tag === 'number')
        void NativeRuntime.registerVideoSurface(
          tag,
          viewID
        )
          .then(() => {
            if (mounted) callback.current();
            else NativeRuntime.unregisterVideoSurface(viewID);
          })
          .catch(error => {
            if (mounted) {
              XmaxLogger.render.error(
                XmaxLogger.localized(
                  '无法注册原生视频画布',
                  'Unable to register native video canvas',
                ),
              );
              failure.current(error);
            }
          });
      return () => {
        mounted = false;
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
