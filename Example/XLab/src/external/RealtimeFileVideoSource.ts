import { NativeModules } from 'react-native';
import type {
  RealtimeExternalVideoSource,
  RealtimeExternalFrameSink,
  RealtimeVideoFormat,
} from '@xmaxai/react-native-sdk';

interface PreparedSource {
  sourceID: string;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

interface FileCaptureModule {
  prepare(fileURL: string, fps: number): Promise<PreparedSource>;
  start(sourceID: string, sink: string): Promise<void>;
  stop(sourceID: string): Promise<void>;
}

/** Creates an app-owned decoder; video and PCM travel directly from native decoding to the SDK. */
export async function makeRealtimeFileVideoSource(
  fileURL: string,
  videoFormat: RealtimeVideoFormat,
): Promise<RealtimeExternalVideoSource> {
  const native = NativeModules.XLabExternalCapture as
    | FileCaptureModule
    | undefined;
  if (!native) throw new Error('Rebuild XLab to enable external capture');
  const prepared = await native.prepare(fileURL, videoFormat.fps);
  let stopped = false;

  return {
    videoFormat: {
      ...videoFormat,
      width: prepared.width,
      height: prepared.height,
      fps: prepared.fps,
    },
    hasAudio: prepared.hasAudio,
    async start(sink: RealtimeExternalFrameSink) {
      if (stopped) throw new Error('External capture is stopped');
      await native.start(prepared.sourceID, sink.nativeHandle);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await native.stop(prepared.sourceID);
    },
  };
}
