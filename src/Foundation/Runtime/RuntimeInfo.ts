//
//  RuntimeInfo.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Runtime metadata attached to API requests and room signaling.
 */
export interface RuntimeInfo {

  /**
   * The runtime platform identifier.
   */
  readonly platform: string;

  /**
   * The device operating system version.
   */
  readonly os_version: string;

  /**
   * The SDK version attached to requests.
   */
  readonly sdk_version: string;

  /**
   * The device model reported by the native runtime.
   */
  readonly device_model: string;
}

/**
 * Encodes a UUID as a room task identifier with a React Native platform query parameter.
 *
 * @param uuid The function producing unique task, file, or message identifiers.
 * @param platform The platform identifier attached to task metadata.
 * @returns The URL-safe generation task identifier with a platform marker.
 */
export function taskIDFromUUID(
  uuid: string,
  platform: string
): string {
  if (platform !== 'ios' && platform !== 'android')
    throw new Error('Unsupported runtime platform');

  const hex = uuid.replaceAll(
    '-',
    ''
  );

  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error('Invalid runtime UUID');

  const bytes = Array.from(
    { length: 16 },
    (_, i) =>
      Number.parseInt(
        hex.slice(
          i * 2,
          i * 2 + 2
        ),
        16
      ),
  );
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const value =
      ((bytes[i] ?? 0) << 16) |
      ((bytes[i + 1] ?? 0) << 8) |
      (bytes[i + 2] ?? 0);

    encoded += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]!;
    if (i + 1 < bytes.length) encoded += alphabet[(value >>> 6) & 63]!;
    if (i + 2 < bytes.length) encoded += alphabet[value & 63]!;
  }

  return `task-${encoded}?os=rn-${platform}`;
}
