//
//  RemoteMediaFrameController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RemoteStream } from '../../Foundation/RTC/RemoteStream';
import type { RealtimeMediaFrameListener } from '../../Service/Realtime/RealtimeMediaFrameListener';
import { invalid } from '../../Foundation/Errors/XmaxError';

/**
 * Serializes native output registration and result binding changes without transferring frames.
 */
export class RemoteMediaFrameController {

  /**
   * The desired app-owned native receiver, retained across disconnections.
   */
  private listener: RealtimeMediaFrameListener | null = null;

  /**
   * The current result account and nonreusable output binding identity.
   */
  private binding: {

    /**
     * The mapped result account accepting output.
     */
    stream: RemoteStream;

    /**
     * The nonreusable identity shared by this binding's audio and video packets.
     */
    id: string;
  } | null = null;

  /**
   * The ordered native configuration tail, including failed predecessor cleanup.
   */
  private pending = Promise.resolve();

  /**
   * The revision preventing failed obsolete updates from restoring older listener state.
   */
  private revision = 0;

  /**
   * Whether native output has been requested and may require an explicit removal.
   */
  private hasRequestedOutput = false;

  /**
   * Creates an output coordinator without allocating native resources.
   */
  constructor(
    /**
     * The RTC manager controlling native observation under its exclusive lease.
     */
    private readonly rtc: RtcManaging,
  ) {}

  /**
   * Replaces the native consumer; null removes queued output without changing playback.
   *
   * @param listener The live native receiver descriptor, or null to remove it.
   */
  async setListener(
    listener: RealtimeMediaFrameListener | null,
  ): Promise<void> {
    if (
      listener !== null &&
      (!listener ||
        typeof listener.nativeHandle !== 'string' ||
        !listener.nativeHandle.trim())
    )
      throw invalid(
        'Remote media frame listener requires a native consumer handle',
      );
    const previous = this.listener;
    const revision = ++this.revision;
    this.listener = listener
      ? Object.freeze({ nativeHandle: listener.nativeHandle })
      : null;
    try {
      await this.configure();
    } catch (error) {
      if (revision === this.revision) this.listener = previous;
      throw error;
    }
  }

  /**
   * Prepares output for a result account before generation readiness is confirmed.
   *
   * @param stream The mapped result room and account.
   */
  async bind(
    stream: RemoteStream
  ): Promise<void> {
    this.binding = { stream, id: this.rtc.randomUUID() };
    await this.configure();
  }

  /**
   * Retires output while keeping the listener available for a later result binding.
   */
  clear(): Promise<void> {
    this.binding = null;
    return this.configure();
  }

  /**
   * Applies snapshots in order so stale removals cannot disable a replacement binding.
   */
  private configure(): Promise<void> {
    const binding = this.binding;
    const listener = binding ? this.listener : null;
    if (listener) this.hasRequestedOutput = true;
    if (!this.hasRequestedOutput) return this.pending;
    const operation = this.pending.then(() =>
      this.rtc.setRemoteMediaFrameListener(
        listener,
        listener ? binding!.stream : null,
        listener ? binding!.id : null,
      ),
    );
    this.pending = operation.catch(() => {});
    return operation;
  }
}
