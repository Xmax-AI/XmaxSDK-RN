//
//  TrajectoryTouchCoordinates.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { MediaSize } from '../../Service/Realtime/RealtimeVideoFormat';
import type { InteractionPoint } from '../../Media/Interaction/InteractionCoordinateMapper';

/**
 * Maps positions using the overlay's actual page bounds. Child locationX/Y origins may differ;
 * synchronous bounds include root viewport and safe-area offsets.
 *
 * @param touch The touch position reported by the view.
 * @param rect The overlay bounds in page coordinates, including layout offsets.
 * @param viewport The viewport dimensions, in layout units.
 * @returns The overlay-local position, or null for invalid geometry.
 */
export function trajectoryTouchPoint(
  touch: {

    /**
     * The horizontal page coordinate, in layout units.
     */
    pageX: number;

    /**
     * The vertical page coordinate, in layout units.
     */
    pageY: number;
  },
  rect: {

    /**
     * The horizontal coordinate in the enclosing position's coordinate space.
     */
    x: number;

    /**
     * The vertical coordinate in the enclosing position's coordinate space.
     */
    y: number;

    /**
     * The width, in pixels.
     */
    width: number;

    /**
     * The height, in pixels.
     */
    height: number;
  },
  viewport: MediaSize,
): InteractionPoint | null {
  if (
    ![touch.pageX, touch.pageY, rect.x, rect.y, rect.width, rect.height].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;

  return {
    x: ((touch.pageX - rect.x) * viewport.width) / rect.width,
    y: ((touch.pageY - rect.y) * viewport.height) / rect.height,
  };
}
