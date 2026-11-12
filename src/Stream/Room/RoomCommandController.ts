//
//  RoomCommandController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  cancelledError,
  XmaxError,
  XmaxErrorCode,
} from '../../Foundation/Errors/XmaxError';
import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';

/**
 * Commands with service receipts and a bounded background retry schedule.
 */
export type RoomCommandKind =
  | 'start'
  | 'change_condition'
  | 'change_target_size';

/**
 * One immutable logical command and its independently cancellable transport attempts.
 */
interface Command {

  /**
   * The generation operation.
   */
  kind: RoomCommandKind;

  /**
   * The generation task owning the command.
   */
  taskID: string;

  /**
   * The identifier shared by every attempt.
   */
  xid: string;

  /**
   * The frozen serialized payload.
   */
  message: string;

  /**
   * Rejects work belonging to a retired room.
   */
  ensureCurrent: () => void;

  /**
   * Completes on the first successful transport submission.
   */
  resolve: () => void;

  /**
   * Rejects an unresolved caller after cancellation or initial failure.
   *
   * @param error The transport failure or cancellation reason.
   */
  reject: (
    error: unknown
  ) => void;

  /**
   * Removes the caller's cancellation subscription after completion.
   */
  detach: () => void;

  /**
   * The outstanding retry and deadline timers.
   */
  timers: ReturnType<typeof setTimeout>[];

  /**
   * Active transport attempts, with true identifying the original send.
   */
  transports: Map<AbortController, boolean>;

  /**
   * The number of attempts submitted to the transport.
   */
  attempts: number;

  /**
   * Whether more redundant sends may be submitted.
   */
  retrying: boolean;

  /**
   * Whether any complete attempt has succeeded.
   */
  sent: boolean;

  /**
   * Whether a lifecycle or supersession boundary invalidated this command.
   */
  cancelled: boolean;
}

/**
 * Retries logical commands independently of transport completion and generation readiness.
 */
export class RoomCommandController {

  /**
   * Commands awaiting a receipt or original-send completion.
   */
  private readonly pending = new Map<string, Command>();

  /**
   * Orders initial commands without waiting for their receipts or retry budgets.
   */
  private sendTail: Promise<void> = Promise.resolve();

  /**
   * Whether this room lifetime has stopped accepting commands.
   */
  private closed = false;

  /**
   * Creates a scheduler with independently cancellable transport attempts.
   */
  constructor(
    /**
     * Submits one complete transport attempt under its cancellation signal.
     *
     * @param message The frozen serialized command.
     * @param signal Cancels only this transport attempt.
     */
    private readonly sendMessage: (
      message: string,
      signal: AbortSignal,
    ) => Promise<void>,

    /**
     * Creates a fresh logical command identifier.
     */
    private readonly uuid: () => string,

    /**
     * Whether to schedule redundant RTC attempts after the original send.
     */
    private readonly retryEnabled = true,
  ) {}

  /**
   * Freezes a command and cancels superseded work.
   * Completes on the first successful send, independently of receipt arrival.
   *
   * @param kind The generation operation.
   * @param taskID The generation task owning the command.
   * @param createMessage Serializes the command with its assigned xid.
   * @param ensureCurrent Rejects work belonging to an obsolete room.
   * @param signal Cancels the caller's unresolved send and its remaining attempts.
   */
  send(
    kind: RoomCommandKind,
    taskID: string,
    createMessage: (
      xid: string
    ) => string,
    ensureCurrent: () => void = () => {},
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.closed || signal?.aborted) throw cancelledError();
    ensureCurrent();
    const xid = this.uuid();
    const message = createMessage(xid);
    this.cancelMatching(
      command =>
        kind === 'start' ||
        (command.taskID === taskID && command.kind === kind),
    );

    let resolve!: () => void, reject!: (
      error: unknown
    ) => void;
    const result = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const command: Command = {
      kind,
      taskID,
      xid,
      message,
      ensureCurrent,
      resolve,
      reject,
      detach: () => {},
      timers: [],
      transports: new Map(),
      attempts: 0,
      retrying: true,
      sent: false,
      cancelled: false,
    };
    const abort = () => this.cancelCommand(command);
    signal?.addEventListener(
      'abort',
      abort
    );
    command.detach = () => signal?.removeEventListener(
      'abort',
      abort
    );
    this.pending.set(
      xid,
      command
    );

    // Preserve the earlier initial-send barrier even when an intervening command is superseded.
    const settled = result.catch(() => {});
    this.sendTail = this.sendTail.then(() => {
      if (!command.cancelled) this.begin(command);
      return settled;
    });
    return result;
  }

  /**
   * Stops redundant work for a valid receipt without completing the original send.
   *
   * @param xid The acknowledged logical command identifier.
   * @param count The service receipt count; only positive safe integers are accepted.
   */
  acknowledge(
    xid: string,
    count: number
  ): void {
    const command = this.pending.get(xid);
    if (
      !this.retryEnabled ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      !command?.retrying ||
      !command.attempts
    )
      return;
    try {
      command.ensureCurrent();
    } catch (error) {
      this.cancelCommand(
        command,
        error
      );
      return;
    }
    XmaxLogger.room.info(
      () =>
        `Inbound Room Signaling: xid_ack\nCommand: ${command.kind}\nxid: ${xid}\ncount: ${count}\nAttempts: ${command.attempts}`,
    );
    this.stopRetries(command);
  }

  /**
   * Cancels commands belonging to an ended task.
   *
   * @param taskID The ended task; omission cancels every room command.
   */
  cancel(
    taskID?: string
  ): void {
    this.cancelMatching(
      command => taskID === undefined || command.taskID === taskID,
    );
    if (taskID === undefined) this.sendTail = Promise.resolve();
  }

  /**
   * Permanently invalidates this scheduler before the room can be reused.
   */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  /**
   * Sends the original command and, when enabled, schedules retries through the 6000 ms deadline.
   *
   * @param command The current logical command.
   */
  private begin(
    command: Command
  ): void {
    if (this.retryEnabled) {
      for (const delay of [300, 1000, 3000, 3300, 4000, 6000]) {
        command.timers.push(
          setTimeout(
            () => {
              if (!command.retrying || command.cancelled) return;
              if (delay === 6000) {
                XmaxLogger.room.warn(
                  `RTC command ACK not received after 6000 ms; retries stopped: ${command.kind}, xid: ${command.xid}`,
                );
                this.stopRetries(command);
              } else this.attempt(
                command,
                false
              );
            },
            delay
          ),
        );
      }
    }
    this.attempt(
      command,
      true
    );
  }

  /**
   * Submits one attempt while retaining cancellation through native completion.
   *
   * @param command The logical command to send.
   * @param initial Whether this is the original attempt.
   */
  private attempt(
    command: Command,
    initial: boolean
  ): void {
    if (!command.retrying || command.cancelled) return;
    try {
      command.ensureCurrent();
    } catch (error) {
      this.cancelCommand(
        command,
        error
      );
      return;
    }
    const controller = new AbortController();
    command.transports.set(
      controller,
      initial
    );
    command.attempts++;
    try {
      void this.sendMessage(
        command.message,
        controller.signal
      ).then(
        () => this.finishAttempt(
          command,
          controller,
          initial
        ),
        error => this.finishAttempt(
          command,
          controller,
          initial,
          false,
          error
        ),
      );
    } catch (error) {
      this.finishAttempt(
        command,
        controller,
        initial,
        false,
        error
      );
    }
  }

  /**
   * Resolves the caller once and preserves failures of the unresolved original send.
   *
   * @param command The command owning the attempt.
   * @param controller The completed attempt's cancellation controller.
   * @param initial Whether this was the original attempt.
   * @param succeeded Whether the transport fulfilled its submission promise.
   * @param error The rejection reason when submission failed.
   */
  private finishAttempt(
    command: Command,
    controller: AbortController,
    initial: boolean,
    succeeded = true,
    error?: unknown,
  ): void {
    command.transports.delete(controller);
    if (command.cancelled || controller.signal.aborted) return;
    if (succeeded) {
      command.sent = true;
      command.detach();
      command.resolve();
      if (!this.retryEnabled || !command.retrying)
        this.pending.delete(command.xid);
    } else if (initial && !command.sent) {
      if (command.kind === 'start')
        this.cancelMatching(
          other => other !== command && other.taskID === command.taskID,
        );
      this.cancelCommand(
        command,
        XmaxError.from(error)
      );
    } else if (
      command.retrying &&
      XmaxError.from(error).code !== XmaxErrorCode.cancelled
    ) {
      XmaxLogger.room.warn(
        `RTC command retry send failed: ${command.kind}, xid: ${command.xid}`,
      );
    }
  }

  /**
   * Releases queued retries while preserving an unresolved original send.
   *
   * @param command The acknowledged or expired command.
   */
  private stopRetries(
    command: Command
  ): void {
    command.retrying = false;
    command.timers.forEach(clearTimeout);
    command.timers = [];
    for (const [controller, initial] of command.transports) {
      if (!initial || command.sent) controller.abort();
    }
    if (command.sent) this.pending.delete(command.xid);
  }

  /**
   * Cancels all attempts and rejects an unresolved caller.
   *
   * @param command The superseded or invalidated command.
   * @param error The initial transport failure or cancellation reason.
   */
  private cancelCommand(
    command: Command,
    error: unknown = cancelledError(),
  ): void {
    command.cancelled = true;
    this.stopRetries(command);
    for (const controller of command.transports.keys()) controller.abort();
    command.detach();
    command.reject(error);
    this.pending.delete(command.xid);
  }

  /**
   * Cancels a snapshot without mutating the collection being inspected.
   *
   * @param matches Selects commands invalidated by the lifecycle or newer operation.
   */
  private cancelMatching(
    matches: (
      command: Command
    ) => boolean
  ): void {
    for (const command of [...this.pending.values()])
      if (matches(command)) this.cancelCommand(command);
  }
}
