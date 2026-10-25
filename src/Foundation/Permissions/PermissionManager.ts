//
//  PermissionManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { PermissionsAndroid, Platform } from 'react-native';
import NativeRuntime from '../Native/NativeXmaxRuntime';
import type { PermissionManaging } from './PermissionManaging';
import { XmaxError, XmaxErrorCode } from '../Errors/XmaxError';

/**
 * Checks and requests camera and microphone permissions.
 */
export class PermissionManager implements PermissionManaging {

  /**
   * Creates a media permission manager.
   */
  constructor(
    /**
     * The authorization client returning whether the requested access is granted.
     *
     * @param permission The camera or microphone permission to request.
     */
    private readonly request: (
      permission: 'camera' | 'microphone',
    ) => Promise<boolean> = async permission => {
      if (Platform.OS === 'android') {
        const value =
          permission === 'camera'
            ? PermissionsAndroid.PERMISSIONS.CAMERA
            : PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
        if (await PermissionsAndroid.check(value)) return true;
        return (
          (await PermissionsAndroid.request(value)) ===
          PermissionsAndroid.RESULTS.GRANTED
        );
      }
      return await NativeRuntime.requestMediaPermission(permission);
    },
  ) {}

  /**
   * Requests camera access if necessary and verifies authorization.
   * Denied, restricted, or failed requests reject with CAMERA_PERMISSION_DENIED.
   */
  ensureCameraPermission(): Promise<void> {
    return this.ensurePermission(
      'camera',
      XmaxErrorCode.cameraPermissionDenied,
    );
  }

  /**
   * Requests microphone access if necessary and verifies authorization.
   * Denied, restricted, or failed requests reject with MICROPHONE_PERMISSION_DENIED.
   */
  ensureMicrophonePermission(): Promise<void> {
    return this.ensurePermission(
      'microphone',
      XmaxErrorCode.microphonePermissionDenied,
    );
  }

  /**
   * Requires authorization without exposing platform permission errors.
   *
   * @param permission The media permission to request.
   * @param code The SDK error code for missing authorization.
   */
  private async ensurePermission(
    permission: 'camera' | 'microphone',
    code: XmaxErrorCode,
  ): Promise<void> {
    try {
      if (await this.request(permission)) return;
    } catch {
      // Platform authorization failures have the same public result as denied access.
    }
    throw new XmaxError({
      code,
      message: `${
        permission === 'camera' ? 'Camera' : 'Microphone'
      } permission is required. Enable it in Settings.`,
    });
  }
}
