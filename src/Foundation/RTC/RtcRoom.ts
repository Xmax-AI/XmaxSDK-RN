//
//  RtcRoom.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcEvent } from './RtcEvent';
import type { RemoteStream } from './RemoteStream';
import type { RtcPlatformEvent } from './RtcPlatform';
import type { VideoContentMode } from '../Media/Video/VideoContentMode';

/**
 * A room event including completion of native room admission.
 */
export type RtcRoomEvent =
  | RtcEvent
  | {

      /**
       * The completed room admission.
       */
      readonly type: 'joined';
    };

/**
 * A vendor-independent room serving one connection.
 */
export interface RtcRoom {

  /**
   * The mapped remote accounts currently publishing video.
   */
  readonly publishedStreams: readonly RemoteStream[];

  /**
   * Sets the normalized room event handler.
   *
   * @param listener The current room event handler.
   */
  setEventListener(
    listener: (
      event: RtcRoomEvent
    ) => void
  ): void;

  /**
   * Begins native admission; completion is reported by the joined event.
   *
   * @param microphone Whether to publish microphone input.
   */
  join(
    microphone: boolean
  ): Promise<void>;

  /**
   * Normalizes scalar platform events for this room and result account.
   *
   * @param event The platform event received under the current lease.
   */
  receive(
    event: RtcPlatformEvent
  ): void;

  /**
   * Subscribes to the result account's audio without changing its volume.
   *
   * @param stream The result room and account.
   * @param enabled Whether to receive the account's audio.
   */
  subscribeRemoteAudio(
    stream: RemoteStream,
    enabled: boolean
  ): Promise<void>;

  /**
   * Arms one decoded-frame observation for the result account.
   *
   * @param stream The result room and account.
   * @param token The observation identity rejecting retired notifications.
   */
  observeRemoteFrame(
    stream: RemoteStream,
    token: string
  ): Promise<void>;

  /**
   * Clears only the specified frame observation.
   *
   * @param token The observation identity.
   */
  clearRemoteFrame(
    token: string
  ): Promise<void>;

  /**
   * Enqueues signaling in room order.
   *
   * @param message The complete JSON message.
   * @param key The coalescing key replacing older unsent messages.
   */
  sendRoomMessage(
    message: string,
    key?: string
  ): Promise<void>;

  /**
   * Discards pending coalescible messages.
   *
   * @param key The message coalescing key.
   */
  discardPendingMessages(
    key: string
  ): void;

  /**
   * Binds a result account to a mounted video container.
   *
   * @param viewID The native mount identity.
   * @param stream The result room and account.
   * @param mode The video scaling mode.
   */
  bind(
    viewID: string,
    stream: RemoteStream,
    mode: VideoContentMode,
  ): Promise<void>;

  /**
   * Detaches only the container still owned by this stream.
   *
   * @param viewID The native mount identity.
   * @param stream The result room and account.
   */
  unbind(
    viewID: string,
    stream: RemoteStream
  ): void;

  /**
   * Leaves the room and clears callbacks, account mappings, and queued signaling.
   */
  destroy(): Promise<void>;
}
