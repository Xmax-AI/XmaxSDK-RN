//
//  AgoraRtcPlatform.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import NativeRuntime from '../Native/NativeXmaxRuntime';
import { cancelledError } from '../Errors/XmaxError';
import { XmaxLogger } from '../Logging/XmaxLogger';
import { AgoraRtcRoom } from './AgoraRtcRoom';
import type { RtcPlatform, RtcPlatformEvent } from './RtcPlatform';
import type { RealtimeSessionConnection } from '../../Service/Realtime/RealtimeSessionConnection';

/**
 * Adapts native Agora operations to the engine and room interfaces.
 */
export class AgoraRtcPlatform implements RtcPlatform {

  /**
   * The device and SDK metadata used for service requests.
   */
  readonly runtime = {
    ...JSON.parse(NativeRuntime.runtimeInfo()),
    sdk_version: '1.0.4',
  };

  /**
   * Creates a unique resource identity.
   */
  randomUUID(): string {
    return NativeRuntime.randomUUID();
  }

  /**
   * Refreshes foreground state before native resource acquisition.
   */
  prepareRuntime(): Promise<void> {
    return NativeRuntime.prepareRuntime();
  }

  /**
   * Acquires native media ownership while foregrounded.
   *
   * @param owner The exclusive lease identity.
   * @returns Whether native ownership was acquired.
   */
  acquire(
    owner: string
  ): boolean {
    return NativeRuntime.acquire(owner);
  }

  /**
   * Checks active native ownership.
   *
   * @param owner The exclusive lease identity.
   * @returns Whether the lease remains active.
   */
  isActive(
    owner: string
  ): boolean {
    return NativeRuntime.isActive(owner);
  }

  /**
   * Releases only the specified native media owner.
   *
   * @param owner The exclusive lease identity.
   */
  release(
    owner: string
  ): void {
    NativeRuntime.release(owner);
  }

  /**
   * Observes parsed scalar events from the current native owner.
   *
   * @param owner The exclusive lease identity.
   * @param listener The event handler.
   * @returns The idempotent unsubscribe function.
   */
  onEvent(
    owner: string,
    listener: (
      event: RtcPlatformEvent
    ) => void,
  ): () => void {
    const subscription = NativeRuntime.onRtcEvent(value => {
      if (!this.isActive(owner)) return;
      let event: unknown;
      try {
        event = JSON.parse(value);
      } catch {
        XmaxLogger.rtc.warn(
          XmaxLogger.localized(
            '无效的原生 RTC 事件',
            'Invalid native RTC event',
          ),
        );
        return;
      }
      if (
        event &&
        typeof event === 'object' &&
        'owner' in event &&
        event.owner === owner
      )
        listener(event as RtcPlatformEvent);
    });
    return () => subscription.remove();
  }

  /**
   * Serializes a native operation after verifying current media ownership.
   *
   * @param owner The exclusive lease identity.
   * @param operation The native operation name.
   * @param parameters The validated scalar operation parameters.
   * @returns The serialized native operation result.
   */
  async execute(
    owner: string,
    operation: string,
    parameters: object = {},
  ): Promise<string> {
    if (!this.isActive(owner)) throw cancelledError();
    return NativeRuntime.rtcCommand(
      owner,
      JSON.stringify({ operation, ...parameters }),
    );
  }

  /**
   * Creates an unjoined Agora room adapter.
   *
   * @param owner The exclusive engine lease identity.
   * @param connection The room, account, and authentication information.
   * @returns The room adapter retained until disconnection.
   */
  createRoom(
    owner: string,
    connection: RealtimeSessionConnection,
  ): AgoraRtcRoom {
    return new AgoraRtcRoom(
      connection,
      (operation, parameters) => this.execute(
        owner,
        operation,
        parameters
      ),
      () => this.randomUUID(),
    );
  }
}
