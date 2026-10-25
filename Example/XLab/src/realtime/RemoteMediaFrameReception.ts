import { NativeModules } from 'react-native';
import type { XmaxRealtimeManaging } from '@xmaxai/react-native-sdk';

/** The toolbar states while requesting permission, encoding, or saving a recording. */
export type RecordingState = 'idle' | 'preparing' | 'recording' | 'saving';

/** App-owned recording controls; no pixel or PCM buffers cross this boundary. */
export interface RemoteMediaFrameNativeModule {
  createConsumer(): Promise<string>;
  startRecording(handle: string): Promise<void>;
  stopRecording(handle: string): Promise<string>;
  getRecordingError(handle: string): Promise<string | null>;
  releaseConsumer(handle: string): Promise<void>;
}

/** Registers a native MP4 recorder and serializes recording, saving, and receiver cleanup. */
export class RemoteMediaFrameReception {
  private handle: string | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private registered = false;
  private recording = false;
  private preparing: Promise<void> | null = null;
  private saving: Promise<string | null> | null = null;

  constructor(
    private readonly realtime: Pick<
      XmaxRealtimeManaging,
      'setRemoteMediaFrameListener'
    >,
    private readonly native:
      | RemoteMediaFrameNativeModule
      | undefined = NativeModules.XLabRemoteMediaFrames,
  ) {}

  /** Creates the consumer once and retains registration across preview recovery. */
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
      throw new Error('Rebuild XLab to enable remote media recording');
    this.handle = await this.native.createConsumer();
    if (this.closed) return;
    await this.realtime.setRemoteMediaFrameListener({
      nativeHandle: this.handle,
    });
    this.registered = true;
  }

  /** Starts a recording after native album permission is granted. */
  startRecording(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('record.notRecording'));
    if (this.preparing) return this.preparing;
    if (this.recording || this.saving)
      return Promise.reject(new Error('record.alreadyRecording'));
    const operation = (async () => {
      await this.start();
      if (this.closed) throw new Error('record.notRecording');
      await this.native!.startRecording(this.handle!);
      this.recording = true;
    })();
    this.preparing = operation;
    void operation
      .finally(() => {
        if (this.preparing === operation) this.preparing = null;
      })
      .catch(() => {});
    return operation;
  }

  /** Completes pending permission work and saves the native MP4 exactly once. */
  stopRecording(): Promise<string | null> {
    if (this.saving) return this.saving;
    const operation = (async () => {
      await this.preparing?.catch(() => {});
      if (!this.recording || !this.handle) return null;
      this.recording = false;
      return this.native!.stopRecording(this.handle);
    })();
    this.saving = operation;
    void operation
      .finally(() => {
        if (this.saving === operation) this.saving = null;
      })
      .catch(() => {});
    return operation;
  }

  /** Reads only encoder failures; media and per-frame events stay outside JavaScript. */
  async getRecordingError(): Promise<string | null> {
    const handle = this.handle;
    if (this.closed || !this.recording || !handle) return null;
    const failure = await this.native!.getRecordingError(handle);
    if (this.closed || this.handle !== handle || !this.recording) return null;
    if (failure) this.recording = false;
    return failure;
  }

  /** Saves pending recording before unregistering output and releasing native ownership. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await this.opening?.catch(() => {});
      try {
        await this.stopRecording();
      } finally {
        const handle = this.handle;
        this.handle = null;
        try {
          if (this.registered)
            await this.realtime.setRemoteMediaFrameListener(null);
        } finally {
          this.registered = false;
          if (handle) await this.native!.releaseConsumer(handle);
        }
      }
    })();
    return this.closing;
  }
}
