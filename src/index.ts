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

export {
  XmaxEnvironment,
  XmaxLoggerOption,
  type XmaxConfiguration,
} from './Core/XmaxConfiguration';

export type {
  XmaxRealtimeManaging,
  RealtimeStateListener,
  RealtimeNetworkQualityListener,
  RealtimePerformanceAlarmListener,
  UplinkVideoStatisticsListener,
  DownlinkVideoStatisticsListener,
} from './Core/Realtime/XmaxRealtimeManaging';

export * from './Service/Realtime/RealtimeTypes';

export type { MediaServicing } from './Service/Media/MediaService';

export { XmaxError, XmaxErrorCode } from './Foundation/Errors/XmaxError';

export { XmaxVideo, type XmaxVideoProps } from './Render/Video/XmaxVideo';

export {
  XmaxRealtimeVideo,
  type XmaxRealtimeVideoProps,
} from './Render/Video/XmaxRealtimeVideo';

export type {
  XmaxStorageManaging,
  XmaxUploadedFile,
  XmaxDownloadedFile,
  StorageProgress,
  XmaxStorageProgressHandler,
  UploadFileOptions,
  DownloadFileOptions,
} from './Core/Storage/XmaxStorageManaging';

export { DefaultTrajectoryEffectRenderer } from './Render/Trajectory/DefaultTrajectoryEffectRenderer';

export type {
  TrajectoryEffectRendering,
  TrajectoryID,
  TrajectoryPoint,
} from './Render/Trajectory/TrajectoryEffectRendering';
