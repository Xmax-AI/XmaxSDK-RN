//
//  RealtimeModel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from './RealtimeVideoFormat';

/**
 * A realtime generation model supported by XmaxSDK.
 */
export enum RealtimeModel {

  /**
   * The X2.1 realtime generation model.
   */
  x2_1 = 'x2.1',
}

/**
 * The generation canvas and local media constraints for a model.
 */
export interface RealtimeModelSpecification {

  /**
   * The display name of the generation model.
   */
  readonly displayName: string;

  /**
   * The supported frame dimensions and recommended frame rates.
   *
   * Camera dimensions must match an entry exactly. Images and external video retain their media
   * aspect ratio and use the closest generation canvas. An empty array allows variable canvas
   * dimensions, resolved using pixel limits and alignment.
   */
  readonly supportedVideoFormats: readonly RealtimeVideoFormat[];

  /**
   * The minimum local media and uplink pixel area.
   */
  readonly minimumInputPixels: number;

  /**
   * The maximum local media pixel area.
   */
  readonly maximumInputPixels: number;

  /**
   * The dimension alignment for variable generation canvases, in pixels.
   */
  readonly inputSizeAlignment: number;

  /**
   * The default local input frame rate, in fps.
   */
  readonly defaultFrameRate: number;

  /**
   * The model's default camera capture dimensions and frame rate.
   */
  readonly defaultCameraVideoFormat: RealtimeVideoFormat;
}

/**
 * The X2.1 media constraints and default camera format.
 */
const specification: RealtimeModelSpecification = Object.freeze({
  displayName: 'X2.1',
  supportedVideoFormats: Object.freeze([
    Object.freeze({ width: 1920, height: 1080, fps: 30 }),
    Object.freeze({ width: 1080, height: 1920, fps: 30 }),
    Object.freeze({ width: 1408, height: 1408, fps: 30 }),
    Object.freeze({ width: 1152, height: 1536, fps: 30 }),
    Object.freeze({ width: 1536, height: 1152, fps: 30 }),
  ]),
  minimumInputPixels: 200000,
  maximumInputPixels: 2100000,
  inputSizeAlignment: 32,
  defaultFrameRate: 30,
  defaultCameraVideoFormat: Object.freeze({
    width: 1080,
    height: 1920,
    fps: 30,
  }),
});

/**
 * The sizing constraints for supported generation models.
 */
export const realtimeModelSpecifications: Readonly<
  Record<RealtimeModel, RealtimeModelSpecification>
> = Object.freeze({
  [RealtimeModel.x2_1]: specification,
});

/**
 * The camera format for the default model.
 */
export const defaultCameraVideoFormat: RealtimeVideoFormat =
  realtimeModelSpecifications[RealtimeModel.x2_1].defaultCameraVideoFormat;
