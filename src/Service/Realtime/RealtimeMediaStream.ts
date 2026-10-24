//
//  RealtimeMediaStream.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoTrack } from './RealtimeVideoTrack';

/**
 * A manager-owned local or remote stream. Connections accept only streams created by the same
 * manager.
 */
export interface RealtimeMediaStream {

  /**
   * The stable identifier of this media stream.
   */
  readonly id: string;

  /**
   * The currently valid video track.
   */
  readonly videoTrack: RealtimeVideoTrack | null;
}
