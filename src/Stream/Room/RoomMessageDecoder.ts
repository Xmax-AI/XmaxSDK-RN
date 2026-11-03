//
//  RoomMessageDecoder.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { utf8Length } from '../../Foundation/RTC/RtcMessageQueue';

/**
 * Fields accepted from an untrusted room message after JSON decoding.
 */
type Message = Record<string, unknown>;

/**
 * One bounded partial message from a single sender.
 */
interface PartialMessage {

  /**
   * The declared number of fragments.
   */
  count: number;

  /**
   * The UTF-8 bytes retained by this message.
   */
  bytes: number;

  /**
   * The received fragments indexed by zero-based position.
   */
  parts: Map<number, string>;
}

/**
 * Reassembles bounded, possibly out-of-order provider fragments for one room lifetime.
 */
export class RoomMessageDecoder {

  /**
   * Partial messages in insertion order, keyed by sender and provider event identifier.
   */
  private readonly records = new Map<string, PartialMessage>();

  /**
   * The aggregate UTF-8 bytes retained by incomplete messages.
   */
  private bytes = 0;

  /**
   * Decodes a plain JSON object or completed Agora fragment envelope.
   *
   * @param sender The remote account owning these fragments.
   * @param data The UTF-8 JSON packet.
   * @returns The decoded object, or null for incomplete, malformed, or oversized data.
   */
  decode(
    sender: string,
    data: string
  ): Message | null {
    if (utf8Length(data) > 262144) return null;
    const message = this.parse(data);
    if (!message || message.event !== '__agora_chunk__') return message;
    const { eventId, index, count, data: part } = message;
    if (
      typeof eventId !== 'string' ||
      !eventId ||
      typeof part !== 'string' ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count <= 0 ||
      count > 512 ||
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count
    )
      return null;

    const key = JSON.stringify([sender, eventId]);
    const record = this.records.get(key) ?? {
      count,
      bytes: 0,
      parts: new Map<number, string>(),
    };
    if (record.count !== count) return null;
    const added = utf8Length(part) - utf8Length(record.parts.get(index) ?? '');
    if (record.bytes + added > 262144) {
      this.remove(key);
      return null;
    }
    record.parts.set(
      index,
      part
    );
    record.bytes += added;
    this.bytes += added;
    this.records.set(
      key,
      record
    );
    while (this.records.size > 1000 || this.bytes > 32 * 1024 * 1024)
      this.remove(this.records.keys().next().value!);
    if (!this.records.has(key) || record.parts.size !== count) return null;
    this.remove(key);
    return this.parse(
      Array.from(
        { length: count },
        (_, i) => record.parts.get(i)!
      ).join(''),
    );
  }

  /**
   * Releases all partial messages when the room is invalidated.
   */
  reset(): void {
    this.records.clear();
    this.bytes = 0;
  }

  /**
   * Parses only JSON objects without coercing receipt fields.
   *
   * @param data The complete JSON object text.
   * @returns The object, or null for malformed JSON and other JSON values.
   */
  private parse(
    data: string
  ): Message | null {
    try {
      const value: unknown = JSON.parse(data);
      return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
        ? (value as Message)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Removes a partial message while maintaining the aggregate byte budget.
   *
   * @param key The sender and provider identifier key.
   */
  private remove(
    key: string
  ): void {
    const record = this.records.get(key);
    if (record) this.bytes -= record.bytes;
    this.records.delete(key);
  }
}
