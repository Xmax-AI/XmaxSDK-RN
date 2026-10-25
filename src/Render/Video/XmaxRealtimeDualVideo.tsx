//
//  XmaxRealtimeDualVideo.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import NativeRuntime from '../../Foundation/Native/NativeXmaxRuntime';
import type { TrajectoryEffectRendering } from '../Trajectory/TrajectoryEffectRendering';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from 'react';
import { findNodeHandle, StyleSheet, View, type ViewProps } from 'react-native';
import { VideoSurface } from './XmaxRealtimeVideo';
import { videoBinding } from './VideoRenderRegistry';
import { VideoContentMode } from '../../Foundation/Media/Video/VideoContentMode';
import type { RealtimeVideoTrack } from '../../Service/Realtime/RealtimeVideoTrack';

/**
 * Properties for overlaying local and remote video tracks and switching between them.
 */
export interface XmaxRealtimeDualVideoProps extends ViewProps {

  /**
   * The local preview track, owned by the same manager as remoteTrack.
   */
  localTrack?: RealtimeVideoTrack | null;

  /**
   * The remote track displayed after task confirmation and a matching render event.
   */
  remoteTrack?: RealtimeVideoTrack | null;

  /**
   * The scaling mode for both video layers; defaults to VideoContentMode.fill.
   */
  videoContentMode?: VideoContentMode;

  /**
   * Whether remote generation accepts multitouch interaction; defaults to true.
   */
  isInteractionEnabled?: boolean;

  /**
   * The custom trajectory renderer; null or omission uses the default green effect.
   */
  trajectoryRenderer?: TrajectoryEffectRendering | null | undefined;
}

/**
 * A video view that overlays confirmed remote output on local preview. Both tracks must share a
 * manager. Remote output appears without animation after its first frame renders. Removing remote
 * output reveals preview; unmounting does not close the manager. Your app owns loading and error UI.
 *
 * @param props The local and remote tracks, scaling mode, interaction renderer, and view styles.
 */
export function XmaxRealtimeDualVideo(
  {
    localTrack,
    remoteTrack,
    videoContentMode = VideoContentMode.fill,
    isInteractionEnabled = true,
    trajectoryRenderer,
    style,
    ...props
  }: XmaxRealtimeDualVideoProps
) {
  const local = videoBinding(localTrack),
    remote = videoBinding(remoteTrack);

  if (local && remote && local.owner !== remote.owner)
    throw new Error(
      'Video tracks must belong to the same Xmax realtime manager',
    );

  return (
    <View {...props} style={[styles.container, style]}>
      <VideoSurface
        isInteractionEnabled={false}
        track={localTrack ?? null}
        videoContentMode={videoContentMode}
        style={StyleSheet.absoluteFill}
      />
      {remoteTrack && (
        <RemoteVideoLayer
          key={remote?.id ?? remoteTrack.id}
          isInteractionEnabled={isInteractionEnabled}
          trajectoryRenderer={trajectoryRenderer}
          track={remoteTrack}
          videoContentMode={videoContentMode}
        />
      )}
    </View>
  );
}

/**
 * Displays confirmed output and hides its native view before RTC resources are released.
 *
 * @param props The result track, scaling mode, and interaction renderer.
 */
function RemoteVideoLayer(
  {
    track,
    videoContentMode,
    isInteractionEnabled,
    trajectoryRenderer,
  }: {

    /**
     * The manager-owned video track; invalid tracks display no video.
     */
    track: RealtimeVideoTrack;

    /**
     * The fit or fill scaling mode.
     */
    videoContentMode: VideoContentMode;

    /**
     * Whether to sample interactions on active remote generation.
     */
    isInteractionEnabled: boolean;

    /**
     * The view's trajectory renderer; null selects the default.
     */
    trajectoryRenderer: TrajectoryEffectRendering | null | undefined;
  }
) {
  const record = videoBinding(track);
  const container = useRef<ComponentRef<typeof View>>(null);
  const nativeID = `xmax-remote-${record?.id ?? track.id}`;

  useLayoutEffect(
    () => {
      if (!record) return;
      const hide = async () => {
        const tag = findNodeHandle(container.current);
        if (typeof tag === 'number')
          await NativeRuntime.hideVideoContainer(
            tag,
            nativeID
          );
      };
      record.hideBeforeRelease.add(hide);

      return () => {
        record.hideBeforeRelease.delete(hide);
      };
    },
    [record, nativeID]
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      record?.listeners.add(listener);

      return () => {
        record?.listeners.delete(listener);
      };
    },
    [record],
  );

  useSyncExternalStore(
    subscribe,
    () => record?.version ?? 0
  );
  const [displayed, setDisplayed] = useState(false);

  /**
   * Ignore late hiding notifications from removed canvases; only the current binding may reveal
   * output.
   */
  const visible =
    displayed && record?.valid && !record.retiring && record.confirmed;

  return (
    <View
      ref={container}
      nativeID={nativeID}
      collapsable={false}
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, !visible && styles.hidden]}
    >
      <VideoSurface
        isInteractionEnabled={isInteractionEnabled}
        trajectoryRenderer={trajectoryRenderer}
        track={track}
        videoContentMode={videoContentMode}
        onDisplayed={setDisplayed}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * The video container's layout and clipping styles.
 */
const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
  hidden: { opacity: 0 },
});
