//
//  RealtimeVideoTrack.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from './RealtimeVideoFormat';
import { CameraPosition } from '../../Foundation/Media/Camera/CameraPosition';

/**
 * A manager-owned video track with stable object identity.
 *
 * The format and camera position reflect the current binding and are cleared when it becomes
 * invalid. Do not construct replacement tracks.
 */
export interface RealtimeVideoTrack {

  /**
   * The stable identifier of this video track.
   */
  readonly id: string;

  /**
   * The current video dimensions and frame rate.
   */
  readonly videoFormat: RealtimeVideoFormat | null;

  /**
   * The camera position; image and remote tracks have no position.
   */
  readonly position: CameraPosition | null;
}
