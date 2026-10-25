//
//  index.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Version information for XmaxSDK React Native.
 */
export const XmaxSDKInfo = Object.freeze({ version: '1.0.4' });

export { XmaxClient } from './Core/XmaxClient';

export type { XmaxConfiguration } from './Core/XmaxConfiguration';

export { XmaxEnvironment } from './Core/XmaxEnvironment';

export { XmaxLoggerOption } from './Foundation/Logging/XmaxLoggerOption';

export type {
  XmaxRealtimeManaging,
  RealtimeStateListener,
  RealtimeNetworkQualityListener,
  RealtimePerformanceAlarmListener,
  UplinkVideoStatisticsListener,
  DownlinkVideoStatisticsListener,
} from './Core/Realtime/XmaxRealtimeManaging';

export * from './Service/Realtime/RealtimeModel';
export * from './Service/Realtime/RealtimeCameraPreset';
export * from './Service/Realtime/RealtimeVideoFormat';
export * from './Service/Realtime/RealtimeState';
export * from './Service/Realtime/RealtimeVideoTrack';
export * from './Service/Realtime/RealtimeMediaStream';
export * from './Service/Realtime/RealtimeNetworkQuality';
export * from './Service/Realtime/RealtimePerformanceAlarm';
export * from './Service/Realtime/RealtimeContext';
export * from './Core/Realtime/RealtimeOperationOptions';
export * from './Foundation/RTC/VideoStatistics';
export * from './Core/Realtime/RealtimeConfiguration';
export * from './Foundation/Media/Camera/CameraPosition';
export * from './Foundation/Media/Video/VideoContentMode';
export * from './Stream/Quality/RealtimeQualityLevel';

export type { MediaServicing } from './Service/Media/MediaServicing';

export { XmaxError, XmaxErrorCode } from './Foundation/Errors/XmaxError';

export { XmaxVideo, type XmaxVideoProps } from './Render/Video/XmaxVideo';

export {
  XmaxRealtimeVideo,
  type XmaxRealtimeVideoProps,
} from './Render/Video/XmaxRealtimeVideo';

export type {
  XmaxStorageManaging,
  UploadFileOptions,
  DownloadFileOptions,
} from './Core/Storage/XmaxStorageManaging';

export type { XmaxUploadedFile } from './Core/Storage/XmaxUploadedFile';

export type { XmaxDownloadedFile } from './Core/Storage/XmaxDownloadedFile';

export type { StorageProgress } from './Core/Storage/StorageProgress';

export type { XmaxStorageProgressHandler } from './Core/Storage/XmaxStorageProgressHandler';

export { DefaultTrajectoryEffectRenderer } from './Render/Trajectory/DefaultTrajectoryEffectRenderer';

export type {
  TrajectoryEffectRendering,
  TrajectoryID,
  TrajectoryPoint,
} from './Render/Trajectory/TrajectoryEffectRendering';

export * from './Service/Media/RealtimeMediaSource';
