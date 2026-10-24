//
//  RtcEvent.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxError } from '../Errors/XmaxError';
import type { RemoteStream } from './RemoteStream';
import type {
  RealtimeNetworkQuality,
  RealtimePerformanceAlarm,
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * Normalized RTC events using stable string accounts and measured metrics.
 */
export type RtcEvent =
  | {

      /**
       * The event or result discriminator.
       */
      type: 'localFrame' | 'captureReady';
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'rendered' | 'decoded';

      /**
       * The remote video's room and account.
       */
      stream: RemoteStream;

      /**
       * The width, in pixels.
       */
      width: number;

      /**
       * The height, in pixels.
       */
      height: number;
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'publication';

      /**
       * The remote video's room and account.
       */
      stream: RemoteStream;

      /**
       * Whether the remote account is publishing video.
       */
      published: boolean;
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'error';

      /**
       * The SDK error associated with the event or final state.
       */
      error: XmaxError;

      /**
       * The resources released by this cleanup.
       */
      scope?: 'connection' | 'all';
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'quality';

      /**
       * The most recent uplink and downlink network quality snapshot.
       */
      quality: RealtimeNetworkQuality;
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'performance';

      /**
       * The device performance limitation or recovery notification.
       */
      alarm: RealtimePerformanceAlarm;
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'uplinkStatistics';

      /**
       * The measured video statistics for one direction.
       */
      statistics: UplinkVideoStatistics;
    }
  | {

      /**
       * The event or result discriminator.
       */
      type: 'downlinkStatistics';

      /**
       * The measured video statistics for one direction.
       */
      statistics: DownlinkVideoStatistics;
    };
