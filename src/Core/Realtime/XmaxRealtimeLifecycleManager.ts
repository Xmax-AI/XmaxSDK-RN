//
//  XmaxRealtimeLifecycleManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  cancelledError,
  invalid,
  XmaxError,
  XmaxErrorCode,
} from '../../Foundation/Errors/XmaxError';
import { XmaxRealtimeErrorManager } from './XmaxRealtimeErrorManager';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import {
  RealtimeConnectionState,
  type RealtimeReason,
  type RealtimeState,
} from '../../Service/Realtime/RealtimeTypes';
import type { RealtimeStateListener } from './XmaxRealtimeManaging';

/**
 * The resources released when disconnecting or closing local media.
 */
export type TerminationScope = 'connection' | 'all';
/**
 * Operation categories used to prevent overlapping resource changes.
 */
type OperationKind =
  | 'media'
  | 'connection'
  | 'generation'
  | 'cameraSwitch'
  | 'configuration';

/**
 * A lease that permits only the current operation to commit state.
 */
export interface RealtimeOperation {

  /**
   * The operation's cancellation signal.
   */
  readonly signal: AbortSignal;

  /**
   * Throws if the operation has been cancelled or replaced.
   */
  ensureCurrent(): void;

  /**
   * Sets the resource scope released after operation failure.
   *
   * @param scope Whether to release the connection alone or all local and remote media.
   */
  setFailureScope(
    scope: TerminationScope
  ): void;
}

/**
 * An admitted operation and its cancellation and cleanup state.
 */
interface Operation {

  /**
   * The operation category used for mutual exclusion.
   */
  kind: OperationKind;

  /**
   * The controller that cancels this operation.
   */
  controller: AbortController;

  /**
   * The shared Promise for operation completion.
   */
  completion: Promise<unknown>;

  /**
   * The cleanup scope on failure; null preserves existing resources.
   */
  failureScope: TerminationScope | null;

  /**
   * The original terminal error, retained instead of a subsequent cancellation error.
   */
  terminalError: XmaxError | null;

  /**
   * The shared cleanup task.
   */
  termination: Promise<void> | null;

  /**
   * Whether this operation has published Preparing state.
   */
  preparationStarted: boolean;
}

/**
 * A shared cleanup request and its final-state information.
 */
interface Termination {

  /**
   * The resources released by this cleanup.
   */
  scope: TerminationScope;

  /**
   * The reason reported in the final state.
   */
  reason: RealtimeReason;

  /**
   * The server session identifier.
   */
  sessionID: string | null;

  /**
   * The currently admitted operation.
   */
  operation: Operation | null;

  /**
   * The shared Promise for operation completion.
   */
  completion: Promise<void>;
}

/**
 * Coordinates realtime operation admission, state commitment, and resource cleanup.
 */
export class XmaxRealtimeLifecycleManager {

  /**
   * The immutable lifecycle state snapshot.
   */
  private state: RealtimeState = Object.freeze({
    connectionState: RealtimeConnectionState.idle,
    sessionID: null,
    taskID: null,
    reason: null,
  });

  /**
   * The state change handler.
   */
  private listener: RealtimeStateListener | null = null;

  /**
   * The currently admitted operation.
   */
  private operation: Operation | null = null;

  /**
   * The shared cleanup task.
   */
  private termination: Termination | null = null;

  /**
   * The internal observer notified as connection or media resources are released.
   */
  private cleanupListener: ((
    scope: TerminationScope
  ) => void) | null = null;

  /**
   * Creates a realtime lifecycle manager.
   */
  constructor(
    /**
     * Releases the resources in the requested scope.
     *
     * @param scope The connection or complete media scope to release.
     */
    private readonly cleanup: (
      scope: TerminationScope
    ) => Promise<void>,

    /**
     * Determines whether reusable local media remains.
     */
    private readonly hasLocalMedia: () => boolean,

    /**
     * Reads the most recently allocated server session identifier.
     */
    private readonly lastSessionID: () => string | null = () => null,

    /**
     * Pauses local capture immediately; final release waits for the active operation.
     */
    private readonly pauseLocalCapture: () => void = () => {},

    /**
     * The error manager shared by runtime callbacks and lifecycle operations.
     */
    private readonly errorManager: XmaxRealtimeErrorManager = new XmaxRealtimeErrorManager(),
  ) {}

  /**
   * Sets the internal resource cleanup observer.
   *
   * @param listener The observer receiving completed cleanup phases, or null to remove it.
   */
  setCleanupListener(
    listener: ((
      scope: TerminationScope
    ) => void) | null,
  ): void {
    this.cleanupListener = listener;
  }

  /**
   * Reports a released resource scope to the facade without changing lifecycle state.
   *
   * @param scope The connection or complete media scope whose cleanup has finished.
   */
  didCleanup(
    scope: TerminationScope
  ): void {
    this.cleanupListener?.(scope);
  }

  /**
   * Defers adaptation while an operation or cleanup is active.
   */
  get isBusy(): boolean {
    return this.operation !== null || this.termination !== null;
  }

  /**
   * The immutable connection, session, task, and termination snapshot.
   *
   * @returns The lifecycle snapshot committed before listener notification.
   */
  get currentState(): RealtimeState {
    return this.state;
  }

  /**
   * Replaces the state listener and immediately delivers the current state; null removes it.
   *
   * @param listener The replacement listener, or null to remove it.
   */
  setStateListener(
    listener: RealtimeStateListener | null
  ): void {
    this.listener = listener;
    this.notify(listener);
  }

  /**
   * Marks an attached local camera preview as ready.
   */
  localPreviewDidBecomeReady(): void {
    if (
      !this.termination &&
      this.state.connectionState === RealtimeConnectionState.preparing
    )
      this.setState({
        ...this.state,
        connectionState: RealtimeConnectionState.ready,
      });
  }

  /**
   * Rejects overlapping operations. Configuration validation failures preserve active generation.
   *
   * @param kind The operation's mutual-exclusion category.
   * @param action The work performed under this operation's cancellation and ownership lease.
   * @param signal The operation's cancellation signal.
   * @returns The valid operation result; rejects for overlap, cancellation, or failure.
   */
  run<T>(
    kind: OperationKind,
    action: (
      token: RealtimeOperation
    ) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelledError());
    if (this.operation || this.termination)
      return Promise.reject(
        invalid('Another realtime operation is in progress'),
      );

    const entry: Operation = {
      kind:
        kind === 'generation' &&
        this.state.connectionState === RealtimeConnectionState.generating
          ? 'configuration'
          : kind,
      controller: new AbortController(),
      completion: Promise.resolve(),
      failureScope: null,
      terminalError: null,
      termination: null,
      preparationStarted: false,
    };
    const token: RealtimeOperation = {
      signal: entry.controller.signal,
      ensureCurrent: () => {
        if (entry.controller.signal.aborted || this.operation !== entry) {
          throw entry.terminalError ?? cancelledError();
        }
      },
      setFailureScope: scope => {
        entry.failureScope = scope;
      },
    };
    this.operation = entry;
    const cancel = () => {
      if (this.operation === entry) entry.controller.abort();
    };
    signal?.addEventListener(
      'abort',
      cancel,
      { once: true }
    );
    const body = Promise.resolve().then(() => {
      token.ensureCurrent();
      return action(token);
    });
    // Cleanup waits for the operation body, not the caller Promise that itself awaits cleanup.
    entry.completion = body.then(
      () => {},
      () => {},
    );
    return body
      .then(value => {
        token.ensureCurrent();
        if (this.operation === entry) this.operation = null;
        return value;
      })
      .catch(async error => {
        const aborted = entry.controller.signal.aborted;
        const failure = aborted
          ? entry.terminalError ?? cancelledError()
          : XmaxError.from(error);
        if (entry.termination) {
          await entry.termination;
        } else if (
          this.operation === entry &&
          entry.kind !== 'configuration' &&
          entry.failureScope
        ) {
          await this.terminate(
            entry.failureScope,
            failure.code === XmaxErrorCode.cancelled
              ? { type: 'normal' }
              : { type: 'failure', error: failure },
          );
        } else {
          if (this.operation === entry) this.operation = null;
          if (
            entry.preparationStarted &&
            entry.kind === 'media' &&
            this.state.connectionState === RealtimeConnectionState.preparing
          )
            this.setState({
              connectionState: RealtimeConnectionState.idle,
              sessionID: null,
              taskID: null,
              reason: null,
            });
        }
        if (failure.code !== XmaxErrorCode.cancelled)
          this.errorManager.report(
            failure,
            'Realtime operation failed'
          );
        throw entry.terminalError ?? failure;
      })
      .finally(() => signal?.removeEventListener(
        'abort',
        cancel
      ));
  }

  /**
   * Commits state only while the operation lease remains current.
   *
   * @param state The state snapshot to commit or deliver.
   * @param token The operation lease that must remain current at commitment.
   */
  commit(
    state: RealtimeState,
    token: RealtimeOperation
  ): void {
    token.ensureCurrent();
    if (
      state.connectionState === RealtimeConnectionState.preparing &&
      this.operation
    )
      this.operation.preparationStarted = true;
    this.setState(state);
  }

  /**
   * Disconnects without interrupting unrelated local media preparation.
   *
   * Completes after remote cleanup while retaining local media. Concurrent calls share cleanup.
   *
   * @param reason The final termination reason; defaults to normal disconnection.
   */
  disconnect(
    reason: RealtimeReason = { type: 'normal' }
  ): Promise<void> {
    if (
      !this.termination &&
      (!this.operation || this.operation.kind === 'media') &&
      [
        RealtimeConnectionState.idle,
        RealtimeConnectionState.preparing,
        RealtimeConnectionState.ready,
      ].includes(this.state.connectionState)
    )
      return Promise.resolve();
    return this.terminate(
      'connection',
      reason
    );
  }

  /**
   * Starts shared cleanup; close may expand the scope to all resources.
   *
   * The shared task completing after resource release and final-state delivery.
   *
   * @param scope Whether to release the connection alone or all local and remote media.
   * @param reason The final termination reason; defaults to normal disconnection.
   */
  terminate(
    scope: TerminationScope,
    reason: RealtimeReason = { type: 'normal' },
  ): Promise<void> {
    const existing = this.termination;
    if (existing) {
      // Late room errors must not replace a user-initiated termination reason.
      if (
        scope === 'all' &&
        reason.type === 'failure' &&
        existing.reason.type !== 'failure'
      ) {
        existing.reason = reason;
        if (existing.operation) existing.operation.terminalError = reason.error;
      }
      if (scope === 'all' && existing.scope !== 'all') {
        existing.scope = 'all';
        if (existing.operation) {
          existing.operation.termination = existing.completion;
          existing.operation.controller.abort();
        }
        this.pauseCapture();
      }
      return existing.completion;
    }

    const pending: Termination = {
      scope,
      reason,
      sessionID: this.state.sessionID,
      operation: this.operation,
      completion: Promise.resolve(),
    };
    this.termination = pending;
    pending.completion = Promise.resolve().then(async () => {
      // Wait for active resource users before destroying the room or engine.
      await pending.operation?.completion;
      let cleanedScope: TerminationScope;
      do {
        cleanedScope = pending.scope;
        await this.cleanup(cleanedScope).catch(error => {
          const failure = XmaxError.from(error);
          this.errorManager.report(
            failure,
            'Realtime cleanup failed'
          );
          if (pending.reason.type !== 'failure')
            pending.reason = { type: 'failure', error: failure };
        });
      } while (pending.scope !== cleanedScope);
      const next: RealtimeState = {
        connectionState:
          pending.scope === 'all' || !this.hasLocalMedia()
            ? RealtimeConnectionState.idle
            : RealtimeConnectionState.ready,
        sessionID: this.lastSessionID() ?? pending.sessionID,
        taskID: null,
        reason: pending.reason,
      };
      // Release admission before notification so a final-state listener can start new work.
      if (this.operation === pending.operation) this.operation = null;
      this.termination = null;
      this.setState(next);
    });
    if (
      pending.operation &&
      (scope === 'all' || pending.operation.kind !== 'media')
    ) {
      pending.operation.termination = pending.completion;
      pending.operation.terminalError =
        reason.type === 'failure' ? reason.error : null;
      pending.operation.controller.abort();
    }
    this.setState({
      ...this.state,
      connectionState: RealtimeConnectionState.disconnecting,
      taskID: null,
      reason: null,
    });
    if (scope === 'all') this.pauseCapture();
    return pending.completion;
  }

  /**
   * Pauses frame production immediately and defers destruction until active work completes.
   */
  private pauseCapture(): void {
    try {
      this.pauseLocalCapture();
    } catch {
      XmaxLogger.realtime.warn(
        'Unable to pause local capture during termination',
      );
    }
  }

  /**
   * Publishes a new snapshot only when observable state changes.
   *
   * @param state The state snapshot to commit or deliver.
   */
  private setState(
    state: RealtimeState
  ): void {
    const previous = this.state;
    if (
      previous.connectionState === state.connectionState &&
      previous.sessionID === state.sessionID &&
      previous.taskID === state.taskID &&
      previous.reason === state.reason
    )
      return;
    this.state = Object.freeze({
      ...state,
      reason: state.reason ? Object.freeze({ ...state.reason }) : null,
    });
    XmaxLogger.realtime.info(
      () => `Connection State: ${state.connectionState}`,
    );
    this.notify(this.listener);
  }

  /**
   * Delivers state without propagating listener exceptions.
   *
   * @param listener The state change handler.
   */
  private notify(
    listener: RealtimeStateListener | null
  ): void {
    try {
      listener?.(this.state);
    } catch {
      XmaxLogger.realtime.warn('Host listener threw an exception');
    }
  }
}
