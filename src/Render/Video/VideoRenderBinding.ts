//
//  VideoRenderBinding.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import type { RemoteStream } from '../../Foundation/RTC/RemoteStream';
import type { InteractionControlling } from '../../Media/Interaction/InteractionControlling';
import type { CameraPosition } from '../../Foundation/Media/Camera/CameraPosition';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';

/**
 * The mutable rendering state behind a public video track.
 */
export interface VideoRenderBinding {

  /**
   * The unique identifier of this render binding.
   */
  readonly id: string;

  /**
   * The ownership identity used to reject retired resource holders.
   */
  readonly owner: object;

  /**
   * The RTC engine and room adapter for this manager.
   */
  readonly rtc: RtcManaging;

  /**
   * Whether this binding represents local input.
   */
  readonly local: boolean;

  /**
   * Notifies lifecycle coordination when local preview binding is ready.
   */
  readonly onPreviewReady?: () => void;

  /**
   * Forwards native canvas failures to the owning lifecycle.
   *
   * @param error The failure reported by the operation.
   */
  readonly onBindingFailure?: (
    error: unknown
  ) => void;

  /**
   * The interaction controller for remote output; local preview does not submit interactions.
   */
  readonly interaction: InteractionControlling | null;

  /**
   * Whether this binding still represents an active stream.
   */
  valid: boolean;

  /**
   * Whether output display is retiring, independently of binding validity.
   */
  retiring: boolean;

  /**
   * The shared task awaiting native output hiding.
   */
  retirement: Promise<void> | null;

  /**
   * The native view hiding operations that must complete before remote release.
   */
  readonly hideBeforeRelease: Set<() => Promise<void>>;

  /**
   * Whether the current remote task is confirmed.
   */
  confirmed: boolean;

  /**
   * The video dimensions, frame rate, and encoder bitrate settings.
   */
  format: RealtimeVideoFormat;

  /**
   * The camera position; image and remote tracks have no position.
   */
  position: CameraPosition | null;

  /**
   * The remote room and account; absent for local bindings.
   */
  remote: RemoteStream | null;

  /**
   * The private image copy used by RN Image rather than an RTC canvas.
   */
  imageURL: string | null;

  /**
   * The revision used to reject late asynchronous results.
   */
  version: number;

  /**
   * The subscribers to binding or resource changes.
   */
  readonly listeners: Set<() => void>;
}
