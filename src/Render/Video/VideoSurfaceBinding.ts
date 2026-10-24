//
//  VideoSurfaceBinding.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import type { RemoteStream } from '../../Foundation/RTC/RtcManager';
import type { VideoContentMode } from '../../Service/Realtime/RealtimeTypes';
import type { VideoBinding } from '../RenderController';

/**
 * The binding and remote visibility state of one mounted video canvas.
 *
 * Repeated scaling values do not rebind the canvas. Remote visibility requires task confirmation
 * and a matching render event.
 */
export class VideoSurfaceBinding {

  /**
   * Whether this binding still accepts operations.
   */
  private active = false;

  /**
   * The native canvas scaling mode.
   */
  private mode: VideoContentMode | null = null;

  /**
   * Whether the expected remote account has produced a render event.
   */
  private rendered = false;

  /**
   * Whether native canvas binding has completed.
   */
  private bound = false;

  /**
   * The binding revision used to reject retired completions.
   */
  private revision = 0;

  /**
   * Whether confirmed, rendered remote output is visible.
   */
  private displayed = false;

  /**
   * Removes the render-event subscription.
   */
  private unsubscribe: (() => void) | null = null;

  /**
   * Creates a canvas binding with a remote visibility handler.
   */
  constructor(
    /**
     * The video binding for the mounted canvas.
     */
    private readonly record: VideoBinding,

    /**
     * The unique native identity of the mounted container.
     */
    private readonly viewID: string,

    /**
     * The remote room and account, or null for local preview.
     */
    private readonly stream: RemoteStream | null,

    /**
     * The handler for remote output visibility.
     *
     * @param ready Whether remote output is displayable.
     */
    private readonly onDisplayed: (
      ready: boolean
    ) => void,
  ) {}

  /**
   * Binds the canvas and observes render events from the expected account.
   *
   * @param mode The video fit or fill scaling mode.
   */
  start(
    mode: VideoContentMode
  ): void {
    if (this.active) return;

    this.active = true;
    this.unsubscribe = this.record.rtc.onEvent(event => {
      if (
        !this.active ||
        event.type !== 'rendered' ||
        !this.stream ||
        event.stream.roomID !== this.stream.roomID ||
        event.stream.userID !== this.stream.userID
      )
        return;

      this.rendered = true;
      this.refresh();
    });
    this.setContentMode(mode);
  }

  /**
   * Updates only changed scaling and rejects retired binding completions.
   *
   * @param mode The video fit or fill scaling mode.
   */
  setContentMode(
    mode: VideoContentMode
  ): void {
    if (!this.active || this.mode === mode) return;

    const revision = ++this.revision;
    this.mode = mode;
    this.bound = false;
    const ready = () => {
      if (!this.active || revision !== this.revision) return;
      this.bound = true;
      if (this.record.valid) this.record.onPreviewReady?.();
      this.refresh();
    };
    const failed = (error: unknown) => {
      if (!this.active || revision !== this.revision) return;
      this.record.onBindingFailure?.(error);
      XmaxLogger.render.error('Video canvas binding failed');
      this.mode = null;
      this.bound = false;
      this.refresh();
    };

    try {
      const binding = this.record.rtc.bind(
        this.viewID,
        this.stream,
        mode
      );
      if (binding) void binding.then(
        ready,
        failed
      );
      else ready();
    } catch (error) {
      failed(error);
    }
  }

  /**
   * Updates visibility from binding, confirmation, and first-render state without rebinding.
   */
  refresh(): void {
    const displayed =
      this.active &&
      this.mode !== null &&
      this.bound &&
      this.record.valid &&
      this.record.confirmed &&
      this.rendered;

    if (displayed === this.displayed) return;

    this.displayed = displayed;
    this.onDisplayed(displayed);
  }

  /**
   * Removes render observation and detaches this canvas without affecting a replacement view.
   */
  dispose(): void {
    if (!this.active) return;

    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = null;

    try {
      this.record.rtc.unbind(
        this.viewID,
        this.stream
      );
    } catch {
      // The owning manager may already have closed its engine.
    }
  }
}
