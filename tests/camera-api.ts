import {
  XmaxClient,
  DefaultTrajectoryEffectRenderer,
  type TrajectoryEffectRendering,
  RealtimeModel,
  RealtimeMediaSource,
  RealtimeVideoEncoderPreference,
  realtimeModelSpecifications,
  CameraPosition,
  RealtimeCameraPreset,
  RealtimeQualityLevel,
  type RealtimeVideoFormat,
  VideoContentMode,
  type RealtimeMediaStream,
  type RealtimeState,
  type MediaSize,
  type XmaxRealtimeManaging,
  type XmaxVideoProps,
  type XmaxRealtimeVideoProps,
} from '../lib/typescript';

// Compile the emitted consumer declarations, including negative calls. Never executed.
export async function cameraContract(client: XmaxClient) {
  const bucket: readonly MediaSize[] = realtimeModelSpecifications[RealtimeModel.x2_1].supportedVideoFormats;
  // @ts-expect-error Model buckets cannot be changed by callers.
  bucket.push({ width: 640, height: 480 });
  const pro: XmaxRealtimeManaging = client.createRealtimeManager({
    model: RealtimeModel.x2_1,
  });
  client.createMediaService(RealtimeModel.x2_1);
  await pro.close();

  const preview: XmaxRealtimeManaging = client.createRealtimeManager({
    model: RealtimeModel.x2_1,
  });
  client.createMediaService(RealtimeModel.x2_1);
  await preview.close();

  const manager: XmaxRealtimeManaging = client.createRealtimeManager({
    model: RealtimeModel.x2_1,
  });
  const size: MediaSize = client
    .createMediaService(RealtimeModel.x2_1)
    .resolveMediaSize({ width: 1080, height: 1920 }, RealtimeMediaSource.camera);
  const local = await manager.createLocalCameraStream({
    position: CameraPosition.front,
    videoFormat: { ...size, fps: 30, minimumBitrate: 0, maximumBitrate: 3000,
      encoderPreference: RealtimeVideoEncoderPreference.maintainFramerate },
    useMicrophone: false,
  });
  const format: RealtimeVideoFormat | null = manager.currentCameraVideoFormat;
  const preset: RealtimeCameraPreset | null = manager.currentCameraPreset;
  const level: RealtimeQualityLevel | null = manager.uplinkQualityLevel;
  await manager.updateCameraFormat(RealtimeCameraPreset.resolution1408x1408);
  await manager.updateCameraFormat({ width: 1080, height: 1920, fps: 30 });
  await manager.setUplinkQualityLevel(RealtimeQualityLevel.l1);
  await manager.setDownlinkQualityLevel(RealtimeQualityLevel.l3);
  // @ts-expect-error Quality levels are limited to the declared enum values.
  await manager.setUplinkQualityLevel(6);
  void [format, preset, level];
  const connected: RealtimeMediaStream = await manager.connect({
    localStream: local,
  });
  const generated: RealtimeMediaStream = await manager.startGeneration({
    localStream: local,
    context: { prompt: '水彩' },
    faceRestoration: true,
  });
  const updated: void = await manager.startGeneration({
    context: { prompt: '油画', referencePath: null },
  });
  const state: RealtimeState = manager.currentState;
  const sessionID: string | null = state.sessionID;
  const taskID: string | null = state.taskID;
  const renderer: TrajectoryEffectRendering = new DefaultTrajectoryEffectRenderer();
  const video: XmaxVideoProps = {
    isInteractionEnabled: true,
    trajectoryRenderer: renderer,
    track: local.videoTrack,
    videoContentMode: VideoContentMode.fit,
  };
  const realtimeVideo: XmaxRealtimeVideoProps = {
    isInteractionEnabled: false,
    trajectoryRenderer: null,
    localTrack: local.videoTrack,
    remoteTrack: connected.videoTrack,
  };
  await manager.setStateListener(() => {});
  await manager.setStateListener(null);
  // @ts-expect-error Errors are delivered by state.reason or rejected operations.
  await manager.setErrorListener(null);
  // @ts-expect-error Preview readiness is represented by Ready.
  await manager.setCameraPreviewReadyListener(null);
  await manager.setUplinkVideoStatisticsListener(statistics => {
    const width: number | null | undefined = statistics?.width;
    void width;
  });
  await manager.setDownlinkVideoStatisticsListener(null);
  await manager.setNetworkQualityListener(null);
  await manager.setPerformanceAlarmListener(null);
  await manager.setLocalAudioVolume(0);
  await manager.setRemoteAudioVolume(1);
  await manager.switchCamera();
  await manager.disconnect();
  await manager.stopLocalCameraStream();
  await manager.close();
  // @ts-expect-error No old renamed API.
  manager.getState();
  // @ts-expect-error IDs retain iOS spelling.
  state.sessionId;
  // @ts-expect-error No local video input in this SDK.
  manager.createLocalVideoStream({ fileURL: 'file:///video.mp4' });
  const image: RealtimeMediaStream = await manager.createLocalImageStream({ fileURL: 'file:///image.jpg', videoFormat: null });
  await manager.stopLocalImageStream();
  void image;
  // @ts-expect-error Image input requires a fileURL.
  manager.createLocalImageStream({ uri: 'file:///image.jpg' });
  const storage = client.createStorageManager();
  const uploaded = await storage.uploadImage({fileURL: 'file:///tmp/example.png', progress: p => { const n: number | null = p.fractionCompleted; return n; }});
  const downloaded = await storage.downloadImage({remoteURL: uploaded.url, destinationURL: 'file:///tmp/result.png'});
  const savedFileURL: string = downloaded.fileURL;
  void savedFileURL;
  // @ts-expect-error No interpolation.
  manager.setFrameInterpolationEnabled(true);
  // @ts-expect-error Context-only overload returns void.
  const wrongReturn: RealtimeMediaStream = await manager.startGeneration({
    context: { prompt: '水彩' },
  });
  // @ts-expect-error Public state is readonly.
  state.taskID = 'changed';
  return {
    generated,
    updated,
    sessionID,
    taskID,
    video,
    realtimeVideo,
    wrongReturn,
  };
}

// @ts-expect-error Severity is no longer part of the public error interface.
import type { XmaxErrorSeverity } from '../src';
// @ts-expect-error Separate error listeners were removed.
import type { RealtimeErrorListener } from '../src';
// @ts-expect-error Preview readiness uses the state listener.
import type { RealtimeCameraPreviewReadyListener } from '../src';

async function stateErrors(manager: import('../src').XmaxRealtimeManaging) {
  await manager.setStateListener(state => {
    if (state.reason?.type === 'failure') {
      const error: import('../src').XmaxError = state.reason.error;
      // @ts-expect-error Errors no longer expose severity.
      error.severity;
    }
  });
  await manager.disconnect({ reason: { type: 'orientationChanged' } });
}
void stateErrors;

async function cancellableOperations(manager: import('../src').XmaxRealtimeManaging, localStream: import('../src').RealtimeMediaStream) {
  const controller = new AbortController();
  const options: import('../src').RealtimeOperationOptions = { signal: controller.signal };
  await manager.createLocalCameraStream(options);
  await manager.createLocalImageStream({ fileURL: 'file:///image.jpg', ...options });
  await manager.connect({ localStream, ...options });
  const remote: import('../src').RealtimeMediaStream = await manager.startGeneration({ localStream, context: { prompt: 'test' }, ...options });
  await manager.startGeneration({ context: { prompt: 'updated' }, ...options });
  await manager.switchCamera(options);
  await manager.stopLocalCameraStream(options);
  await manager.stopLocalImageStream(options);
  controller.abort();
  return remote;
}
void cancellableOperations;
