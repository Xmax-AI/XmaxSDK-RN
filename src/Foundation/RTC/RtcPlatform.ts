//
//  RtcPlatform.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RuntimeInfo } from '../Runtime/RuntimeInfo';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';
import type { RtcRoom } from './RtcRoom';

/**
 * Scalar platform metadata delivered under an exclusive engine lease.
 */
export type RtcPlatformEvent = Readonly<Record<string, unknown>>;

/**
 * An engine interface separate from connection waits, timeouts, and leases.
 */
export interface RtcPlatform {

  /**
   * The device and SDK metadata used for service requests.
   */
  readonly runtime: RuntimeInfo;

  /**
   * Creates a unique resource identity.
   */
  randomUUID(): string;

  /**
   * Refreshes foreground state before native resource acquisition.
   */
  prepareRuntime(): Promise<void>;

  /**
   * Acquires native media ownership while foregrounded.
   *
   * @param owner The exclusive lease identity.
   * @returns Whether native ownership was acquired.
   */
  acquire(
    owner: string
  ): boolean;

  /**
   * Checks that a lease still owns active foreground media.
   *
   * @param owner The exclusive lease identity.
   * @returns Whether the lease remains active.
   */
  isActive(
    owner: string
  ): boolean;

  /**
   * Releases only the specified native media owner.
   *
   * @param owner The exclusive lease identity.
   */
  release(
    owner: string
  ): void;

  /**
   * Observes scalar native events belonging to the active lease.
   *
   * @param owner The exclusive lease identity.
   * @param listener The current owner's event handler.
   * @returns The function removing this subscription.
   */
  onEvent(
    owner: string,
    listener: (
      event: RtcPlatformEvent
    ) => void,
  ): () => void;

  /**
   * Executes a native media operation under current ownership.
   *
   * @param owner The exclusive lease identity.
   * @param operation The native operation name.
   * @param parameters The validated scalar operation parameters.
   * @returns The serialized native operation result.
   */
  execute(
    owner: string,
    operation: string,
    parameters?: object,
  ): Promise<string>;

  /**
   * Creates an unjoined room adapter for one connection.
   *
   * @param owner The exclusive engine lease identity.
   * @param connection The room, account, and authentication information.
   * @returns The room adapter retained until disconnection.
   */
  createRoom(
    owner: string,
    connection: RealtimeSessionConnection
  ): RtcRoom;
}
