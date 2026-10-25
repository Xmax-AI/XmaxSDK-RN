import { NativeModules } from 'react-native';
import type { XmaxRealtimeManaging } from '@xmaxai/react-native-sdk';

/** Cumulative packets delivered to the screen's current native receiver. */
export interface RemoteMediaFrameStatistics {
  readonly videoFrames: number;
  readonly audioPackets: number;
}

/** App-owned native consumer lifecycle; no pixel or PCM buffers cross this boundary. */
export interface RemoteMediaFrameNativeModule {
  createConsumer(): Promise<string>;
  getStatistics(handle: string): Promise<RemoteMediaFrameStatistics>;
  releaseConsumer(handle: string): Promise<void>;
}

/** Registers one native receiver for a screen and removes it before releasing ownership. */
export class RemoteMediaFrameReception {
  private handle: string | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private registered = false;

  constructor(
    private readonly realtime: Pick<
      XmaxRealtimeManaging,
      'setRemoteMediaFrameListener'
    >,
    private readonly native:
      | RemoteMediaFrameNativeModule
      | undefined = NativeModules.XLabRemoteMediaFrames,
  ) {}

  /** Creates the native receiver once and retains registration across preview recovery. */
  start(): Promise<void> {
    if (this.closed)
      return Promise.reject(
        new Error('Remote media frame reception is closed'),
      );
    if (this.opening) return this.opening;
    this.opening = this.open();
    return this.opening;
  }

  private async open(): Promise<void> {
    if (!this.native)
      throw new Error('Rebuild XLab to enable remote media frame reception');
    this.handle = await this.native.createConsumer();
    if (this.closed) return;
    await this.realtime.setRemoteMediaFrameListener({
      nativeHandle: this.handle,
    });
    this.registered = true;
  }

  /** Reads scalar counters while the receiver remains owned by this screen. */
  async getStatistics(): Promise<RemoteMediaFrameStatistics | null> {
    const handle = this.handle;
    if (this.closed || !this.registered || !handle || !this.native) return null;
    const statistics = await this.native.getStatistics(handle);
    return this.closed || this.handle !== handle ? null : statistics;
  }

  /** Waits for pending registration, unregisters output, and releases the native receiver once. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await this.opening?.catch(() => {});
      const handle = this.handle;
      this.handle = null;
      try {
        if (this.registered)
          await this.realtime.setRemoteMediaFrameListener(null);
      } finally {
        this.registered = false;
        if (handle) await this.native!.releaseConsumer(handle);
      }
    })();
    return this.closing;
  }
}
