//
//  RealtimeState.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxError } from '../../Foundation/Errors/XmaxError';

/**
 * The lifecycle state of local media, the room connection, and generation.
 */
export enum RealtimeConnectionState {

  /**
   * No local media or active connection is held.
   */
  idle = 'Idle',

  /**
   * The local input is being prepared or its preview is not yet ready.
   */
  preparing = 'Preparing',

  /**
   * The local input is ready without a remote connection.
   */
  ready = 'Ready',

  /**
   * The server session is being created or the RTC room is connecting.
   */
  connecting = 'Connecting',

  /**
   * The room is joined and the result stream exists, but generation is not yet confirmed.
   */
  connected = 'Connected',

  /**
   * The current task is generating video.
   */
  generating = 'Generating',

  /**
   * An operation is being cancelled and its associated resources are being released.
   */
  disconnecting = 'Disconnecting',
}

/**
 * The lifecycle termination reason, cleared when a new operation begins.
 */
export type RealtimeReason =
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'normal';
    }
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'orientationChanged';
    }
  | {

      /**
       * The event or result discriminator.
       */
      readonly type: 'failure';

      /**
       * The SDK error associated with the event or final state.
       */
      readonly error: XmaxError;
    };

/**
 * An immutable snapshot of the current connection and generation identifiers.
 */
export interface RealtimeState {

  /**
   * The current realtime lifecycle state.
   */
  readonly connectionState: RealtimeConnectionState;

  /**
   * The reason for completion, an orientation change, or failure; null while a new operation is in
   * progress.
   */
  readonly reason: RealtimeReason | null;

  /**
   * The current or most recent session identifier, retained after termination.
   */
  readonly sessionID: string | null;

  /**
   * The current generation task identifier; null when no task is generating.
   */
  readonly taskID: string | null;
}
