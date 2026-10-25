//
//  XmaxRealtimeVideo.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { TrajectoryEffectRendering } from '../Trajectory/TrajectoryEffectRendering';
import { TrajectoryOverlay } from '../Trajectory/TrajectoryOverlay';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Image, View, StyleSheet, type ViewProps } from 'react-native';
import { RtcVideoSurface } from '../../Foundation/RTC/RtcVideoSurface';
import { videoBinding } from './VideoRenderRegistry';
import { VideoSurfaceBinding } from './VideoSurfaceBinding';
import { VideoContentMode } from '../../Foundation/Media/Video/VideoContentMode';
import type { RealtimeVideoTrack } from '../../Service/Realtime/RealtimeVideoTrack';

/**
 * Properties for displaying a single local or remote video track.
 */
export interface XmaxRealtimeVideoProps extends ViewProps {

  /**
   * The track to display; absent or invalid tracks show a black background.
   */
  track?: RealtimeVideoTrack | null;

  /**
   * The video scaling mode; defaults to VideoContentMode.fill.
   */
  videoContentMode?: VideoContentMode;

  /**
   * Whether confirmed remote output accepts interactions; defaults to true. Local tracks never
   * accept interactions.
   */
  isInteractionEnabled?: boolean;

  /**
   * The visual renderer, independent of interaction delivery. Defaults to
   * DefaultTrajectoryEffectRenderer; use one instance per mounted view.
   */
  trajectoryRenderer?: TrajectoryEffectRendering | null | undefined;
}

/**
 * Track display properties and remote visibility notifications.
 */
interface SurfaceProps extends XmaxRealtimeVideoProps {

  /**
   * The handler for confirmed remote display visibility.
   *
   * @param ready Whether the remote canvas is confirmed and displayable.
   */
  onDisplayed?: (
    ready: boolean
  ) => void;
}

/**
 * Binds an active track to an RTC view and handles matching render events.
 *
 * @param props The track, scaling mode, visibility handler, interaction renderer, and view styles.
 */
export function VideoSurface(
  {
    track,
    videoContentMode = VideoContentMode.fill,
    onDisplayed,
    isInteractionEnabled = true,
    trajectoryRenderer,
    style,
    ...props
  }: SurfaceProps
) {
  const record = videoBinding(track);
  const viewID = `xmax-${useId().replaceAll(':', '')}-${record?.id ?? 'empty'}`;
  const [loadedViewID, setLoadedViewID] = useState<string | null>(null);
  const loaded = loadedViewID === viewID;
  const [displayedViewID, setDisplayedViewID] = useState<string | null>(null);
  const callback = useRef(onDisplayed);

  callback.current = onDisplayed;

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

  const roomID = record?.remote?.roomID,
    userID = record?.remote?.userID;
  const valid = record?.valid ?? false;
  const binding = useRef<VideoSurfaceBinding | null>(null);
  const mode = useRef(videoContentMode);

  mode.current = videoContentMode;
  useEffect(
    () => {
      setDisplayedViewID(null);
      callback.current?.(false);
      if (
        !loaded ||
        !record ||
        record.imageURL ||
        !valid ||
        (!record.local && (!roomID || !userID))
      )
        return;

      const stream = record.local ? null : { roomID: roomID!, userID: userID! };
      const surface = new VideoSurfaceBinding(
        record,
        viewID,
        stream,
        ready => {
          setDisplayedViewID(ready ? viewID : null);
          callback.current?.(ready);
        }
      );

      binding.current = surface;
      surface.start(mode.current);

      return () => {
        binding.current = null;
        surface.dispose();
      };
    },
    [loaded, record, valid, roomID, userID, viewID]
  );

  useEffect(
    () => {
      binding.current?.setContentMode(videoContentMode);
    },
    [videoContentMode]
  );

  useEffect(
    () => {
      binding.current?.refresh();
    },
    [record?.confirmed]
  );

  return (
    <View {...props} style={[styles.container, style]}>
      {valid && record?.imageURL ? (
        <Image
          key={record.id}
          source={{ uri: record.imageURL }}
          style={StyleSheet.absoluteFill}
          resizeMode={
            videoContentMode === VideoContentMode.fit ? 'contain' : 'cover'
          }
        />
      ) : (
        valid && (
          <RtcVideoSurface
            viewID={viewID}
            onLoad={() => setLoadedViewID(viewID)}
            onError={error => record?.onBindingFailure?.(error)}
          />
        )
      )}
      {isInteractionEnabled &&
        valid &&
        record?.confirmed &&
        record.interaction &&
        displayedViewID === viewID && (
          <TrajectoryOverlay
            key={record.id}
            binding={record}
            contentMode={videoContentMode}
            renderer={trajectoryRenderer}
          />
        )}
    </View>
  );
}

/**
 * A video view displaying a single local or remote video track.
 *
 * Uses RTC rendering for camera and remote tracks and RN Image for local images.
 * Unmounting detaches the view binding; your app still owns the manager lifecycle.
 *
 * @param props The track, scaling mode, interaction options, and view styles.
 */
export function XmaxRealtimeVideo(
  props: XmaxRealtimeVideoProps
) {
  return <VideoSurface {...props} />;
}

/**
 * The video container's layout and clipping styles.
 */
const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
});
