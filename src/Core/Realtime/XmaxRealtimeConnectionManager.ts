//
//  XmaxRealtimeConnectionManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeTiming } from '../../Service/Realtime/RealtimeTiming';
import type { RoomControlling } from '../../Stream/Room/RoomControlling';
import type { RenderControlling } from '../../Render/RenderControlling';
import type { RealtimeSessionServicing } from '../../Service/Realtime/RealtimeSessionServicing';
import type { RealtimeSession } from '../../Service/Realtime/RealtimeSession';
import type { RealtimeModel } from '../../Service/Realtime/RealtimeModel';
import type { RealtimeVideoFormat } from '../../Service/Realtime/RealtimeVideoFormat';
import type { RealtimeMediaStream } from '../../Service/Realtime/RealtimeMediaStream';

import { ensureActive, repeatHeartbeat } from '../../Foundation/Runtime/Async';

/**
 * Manages server sessions, RTC connections, and remote media resources.
 *
 * Sessions allocated after cancellation or containing invalid connection data are reclaimed.
 */
export class XmaxRealtimeConnectionManager {

  /**
   * The active server session.
   */
  session: RealtimeSession | null = null;

  /**
   * The last allocated session identifier, retained for cleanup state notifications.
   */
  lastSessionID: string | null = null;

  /**
   * The manager-owned result stream.
   */
  remoteStream: RealtimeMediaStream | null = null;

  /**
   * Stops future heartbeats and cancels the in-flight heartbeat request.
   */
  private stopHeartbeat: (() => void) | null = null;

  /**
   * Creates a realtime connection manager.
   */
  constructor(
    /**
     * The service that creates, refreshes, and closes server sessions.
     */
    private readonly service: RealtimeSessionServicing,

    /**
     * The room controller for connection and signaling.
     */
    private readonly room: RoomControlling,

    /**
     * The render controller for stream and video-track bindings.
     */
    private readonly render: RenderControlling,

    /**
     * The shared generation startup measurement.
     */
    private readonly timing?: RealtimeTiming,
  ) {}

  /**
   * Creates a session, joins RTC, and returns the result stream. Invalid or late sessions are
   * reclaimed on failure.
   *
   * @param model The generation model defining media constraints and supported formats.
   * @param format The dimensions, frame rate, and bitrate bounds, in pixels, fps, and kbps.
   * @param microphone Whether microphone input is required.
   * @param signal The operation's cancellation signal; cancellation reports CANCELLED.
   * @param onFailure The handler for failures requiring connection cleanup.
   * @returns The manager-owned result stream before generation starts.
   */
  async connect(
    model: RealtimeModel,
    format: RealtimeVideoFormat,
    microphone: boolean,
    signal: AbortSignal,
    onFailure: (
      error: unknown
    ) => void,
  ): Promise<RealtimeMediaStream> {
    this.lastSessionID = null;
    // Cancel transport and reclaim any session allocated by a response that completes first.
    this.timing?.beginSessionCreation();
    const session = await this.service.createSession(
      model,
      signal
    );
    this.timing?.finishSessionCreation();
    this.lastSessionID = session.id;

    try {
      ensureActive(signal);
      await this.room.join(
        session.connection,
        microphone,
        signal
      );
      ensureActive(signal);
      this.session = session;
      this.remoteStream = this.render.create(
        false,
        format,
        null,
        session.connection.botName
          ? {
              roomID: session.connection.roomID,
              userID: session.connection.botName,
            }
          : null,
      );
      this.stopHeartbeat = repeatHeartbeat(
        heartbeatSignal => this.service.heartbeat(
          session.id,
          heartbeatSignal
        ),
        error => {
          if (this.session === session) onFailure(error);
        },
      );

      return this.remoteStream;
    } catch (error) {
      try {
        await this.room.leave();
      } finally {
        await this.service.closeSession(session.id).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Invalidates the result track, stops heartbeats, and closes the room and session while
   * preserving local input.
   *
   * Completes after remote cleanup while retaining local media. Concurrent calls share cleanup.
   */
  async disconnect(): Promise<void> {
    const session = this.session;

    this.session = null;
    this.remoteStream = null;
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    this.render.invalidate(false);

    try {
      await this.room.leave();
    } finally {
      if (session) await this.service.closeSession(session.id);
    }
  }
}
