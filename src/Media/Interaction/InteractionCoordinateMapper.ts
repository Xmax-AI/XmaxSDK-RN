//
//  InteractionCoordinateMapper.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  VideoContentMode,
  type MediaSize,
} from '../../Service/Realtime/RealtimeTypes';

/**
 * A touch position in the viewport or normalized media coordinate space specified by its sample
 * frame.
 */
export interface InteractionPoint {

  /**
   * The horizontal coordinate in the enclosing position's coordinate space.
   */
  readonly x: number;

  /**
   * The vertical coordinate in the enclosing position's coordinate space.
   */
  readonly y: number;
}

/**
 * A simultaneous set of touch samples relative to the video container.
 */
export interface InteractionFrame {

  /**
   * The simultaneous touch points in viewport coordinates.
   */
  readonly points: readonly InteractionPoint[];

  /**
   * The touch viewport dimensions, in logical layout units.
   */
  readonly viewportSize: MediaSize;

  /**
   * The scaling mode mapping video into the viewport.
   */
  readonly contentMode: VideoContentMode;

  /**
   * The check performed before sending to determine whether the gesture was cancelled.
   *
   * @returns Whether the sample still belongs to the current task and gesture.
   */
  readonly isCurrent?: () => boolean;
}

/**
 * Calculates the centered video rectangle, including areas cropped outside the viewport in fill
 * mode.
 *
 * @param viewport The viewport dimensions, in layout units.
 * @param video The video dimensions, in pixels.
 * @param mode The video fit or fill scaling mode.
 * @returns The displayed video rectangle, in logical layout units; null for invalid dimensions.
 */
export function displayedFrame(
  viewport: MediaSize,
  video: MediaSize,
  mode: VideoContentMode,
) {
  if (
    ![viewport.width, viewport.height, video.width, video.height].every(
      value => Number.isFinite(value) && value > 0,
    )
  )
    return null;

  const scale = (mode === VideoContentMode.fill ? Math.max : Math.min)(
    viewport.width / video.width,
    viewport.height / video.height,
  );
  const width = video.width * scale,
    height = video.height * scale;

  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
}

/**
 * Maps touch positions to normalized media coordinates from 0 to 1 using the source aspect ratio.
 * Letterboxed areas in fit mode reject touch input.
 *
 * @param point The position to test or convert in the method's coordinate space.
 * @param viewport The viewport dimensions, in layout units.
 * @param video The video dimensions, in pixels.
 * @param mode The video fit or fill scaling mode.
 * @returns The normalized media coordinates; null for invalid geometry or a position in a fit-mode
 *   margin.
 */
export function mapInteractionPoint(
  point: InteractionPoint,
  viewport: MediaSize,
  video: MediaSize,
  mode: VideoContentMode,
): InteractionPoint | null {
  const frame = displayedFrame(
    viewport,
    video,
    mode
  );

  if (!frame || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    return null;
  if (
    mode === VideoContentMode.fit &&
    (point.x < frame.x ||
      point.y < frame.y ||
      point.x > frame.x + frame.width ||
      point.y > frame.y + frame.height)
  )
    return null;

  return {
    x: Math.min(1, Math.max(0, (point.x - frame.x) / frame.width)),
    y: Math.min(1, Math.max(0, (point.y - frame.y) / frame.height)),
  };
}
