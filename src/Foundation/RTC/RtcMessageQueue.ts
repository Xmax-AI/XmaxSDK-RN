//
//  RtcMessageQueue.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { cancelledError, invalid } from '../Errors/XmaxError';
import { monotonicTime } from '../Runtime/MonotonicTime';

/**
 * Calculates UTF-8 byte length without Node Buffer.
 *
 * @param value The Unicode text whose encoded length is required.
 */
export function utf8Length(
  value: string
): number {
  let size = 0;
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!;
    size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return size;
}

/**
 * Splits messages at Unicode boundaries within native packet limits; rejects empty, oversized, or
 * excessively fragmented messages.
 *
 * @param message The message content to send.
 * @param eventID The unique identifier used to reassemble this message's packets.
 * @returns The ordered native packets, or one packet when direct delivery fits.
 */
export function encodeRoomMessage(
  message: string,
  eventID: string
): string[] {
  const size = utf8Length(message);
  if (!size || size > 262144)
    throw invalid('RTC message must contain between 1 and 262144 bytes');
  if (size <= 800) return [message];
  const chunks: string[] = [];
  let chunk = '',
    length = 0;
  for (const scalar of message) {
    const count = utf8Length(JSON.stringify(scalar)) - 2;
    if (length + count > 600) {
      chunks.push(chunk);
      chunk = '';
      length = 0;
    }
    chunk += scalar;
    length += count;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 512)
    throw invalid('RTC message contains too many fragments');
  return chunks.map((data, index) =>
    JSON.stringify({
      event: '__agora_chunk__',
      eventId: eventID.replaceAll(
        '-',
        ''
      ),
      index,
      count: chunks.length,
      data,
    }),
  );
}

/**
 * The Promise completion and failure handlers retained until message termination.
 */
type Completion = {

  /**
   * Completes the asynchronous operation.
   */
  resolve: () => void;

  /**
   * Rejects the asynchronous operation with an error.
   *
   * @param error The failure reported by the operation.
   */
  reject: (
    error: unknown
  ) => void;
};
/**
 * A room message's packets and callers awaiting submission.
 */
interface Message {

  /**
   * The ordered UTF-8 packets for one message.
   */
  packets: string[];

  /**
   * The coalescing key; matching keys replace only unsent messages.
   */
  key?: string | undefined;

  /**
   * The callers awaiting this message or its coalesced replacement.
   */
  completions: Completion[];

  /**
   * Whether to discard the remaining unsent packets.
   */
  cancelled?: boolean;
}

/**
 * An ordered signaling queue respecting data-stream packet and byte limits.
 *
 * Coalesces pending interactions and limits each rolling second to 58 packets and 29 KB.
 */
export class RtcMessageQueue {

  /**
   * The tasks awaiting submission or native completion.
   */
  private pending: Message[] = [];

  /**
   * Whether the serial submission loop is active.
   */
  private sending = false;

  /**
   * The message being encoded or submitted.
   */
  private current: Message | null = null;

  /**
   * Whether the queue is closed to new work.
   */
  private closed = false;

  /**
   * The successful packet times and sizes within the rate window.
   */
  private sent: {

    /**
     * The submission time, in monotonic seconds.
     */
    time: number;

    /**
     * The UTF-8 packet byte count.
     */
    bytes: number;
  }[] = [];

  /**
   * Cancels the rate-limit timer and resumes the waiting task.
   */
  private wake: (() => void) | null = null;

  /**
   * Creates an ordered, rate-limited room message queue.
   */
  constructor(
    /**
     * Submits one UTF-8 packet and completes after native submission finishes.
     *
     * @param packet The encoded packet to submit.
     */
    private readonly send: (
      packet: string
    ) => Promise<void>,

    /**
     * The function producing unique task, file, or message identifiers.
     */
    private readonly uuid: () => string,
  ) {}

  /**
   * Enqueues messages in order, retaining only the newest unsent content for matching coalescing
   * keys.
   *
   * Completes after this message or its coalesced replacement is submitted; rejects on discard or
   * failure.
   *
   * @param value The room message to split and submit in order.
   * @param key The optional pending-message coalescing key; omission queues each message
   *   independently.
   */
  enqueue(
    value: string,
    key?: string
  ): Promise<void> {
    if (this.closed) return Promise.reject(cancelledError());
    const packets = encodeRoomMessage(
      value,
      this.uuid()
    );
    return new Promise((resolve, reject) => {
      const existing = key
        ? this.pending.find(item => item.key === key)
        : undefined;
      if (existing) {
        existing.packets = packets;
        existing.completions.push({ resolve, reject });
      } else {
        if (this.pending.length >= 128) {
          reject(invalid('RTC message queue is full'));
          return;
        }
        this.pending.push({ packets, key, completions: [{ resolve, reject }] });
      }
      void this.drain();
    });
  }

  /**
   * Discards pending interactions for a finished task; transmitted packets cannot be recalled.
   *
   * @param key The lookup key for resources, preferences, or message coalescing.
   */
  drop(
    key: string
  ): void {
    const retired = this.pending.filter(message => message.key === key);
    this.pending = this.pending.filter(message => message.key !== key);
    if (this.current?.key === key) this.current.cancelled = true;
    for (const message of retired)
      for (const completion of message.completions)
        completion.reject(cancelledError());
    this.wake?.();
  }

  /**
   * Rejects unsent messages and wakes rate-limit waits; transmitted packets cannot be recalled.
   */
  close(): void {
    this.closed = true;
    this.wake?.();
    for (const message of this.pending.splice(0))
      for (const completion of message.completions)
        completion.reject(cancelledError());
  }

  /**
   * Submits queued packets within packet and byte limits, settling each message independently.
   */
  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (!this.closed && this.pending.length) {
        const message = this.pending.shift()!;
        this.current = message;
        try {
          for (const packet of message.packets) {
            if (message.cancelled) throw cancelledError();
            await this.waitForBudget(
              utf8Length(packet),
              message
            );
            if (this.closed || message.cancelled) throw cancelledError();
            await this.send(packet);
            this.sent.push({
              time: monotonicTime(),
              bytes: utf8Length(packet),
            });
          }
          for (const completion of message.completions) completion.resolve();
        } catch (error) {
          for (const completion of message.completions)
            completion.reject(error);
        }
      }
    } finally {
      this.current = null;
      this.sending = false;
    }
  }

  /**
   * Waits for rate-window capacity and rejects retired queues or messages.
   *
   * @param bytes The UTF-8 packet or response byte count.
   * @param message The queue message whose cancellation remains relevant while waiting.
   */
  private async waitForBudget(
    bytes: number,
    message: Message
  ): Promise<void> {
    while (!this.closed && !message.cancelled) {
      const now = monotonicTime();
      this.sent = this.sent.filter(sample => now - sample.time < 1);
      if (
        this.sent.length < 58 &&
        this.sent.reduce(
          (sum, sample) => sum + sample.bytes,
          0
        ) + bytes <=
          29000
      )
        return;
      await new Promise<void>(resolve => {
        const timer = setTimeout(
          () => {
            this.wake = null;
            resolve();
          },
          Math.max(1, (this.sent[0]!.time + 1 - now) * 1000)
        );
        this.wake = () => {
          clearTimeout(timer);
          this.wake = null;
          resolve();
        };
      });
    }
    throw cancelledError();
  }
}
