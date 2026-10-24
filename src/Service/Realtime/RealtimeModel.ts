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
   * The X2.1.1 preview model for China.
   */
  x2_1_1_preview_cn = 'x2.1.1-preview-cn',

  /**
   * The X2.1.1 preview model for global services.
   */
  x2_1_1_preview_us = 'x2.1.1-preview-us',
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
   * The supported camera and canvas dimensions, in pixels, with recommended frame rates.
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
 * The shared X2.1.1 preview media constraints and default camera format.
 */
const specification: RealtimeModelSpecification = Object.freeze({
  displayName: 'X2.1.1-preview-cn',
  supportedVideoFormats: Object.freeze([
    Object.freeze({ width: 1024, height: 1920, fps: 30 }),
    Object.freeze({ width: 1920, height: 1024, fps: 30 }),
  ]),
  minimumInputPixels: 200000,
  maximumInputPixels: 2100000,
  inputSizeAlignment: 32,
  defaultFrameRate: 30,
  defaultCameraVideoFormat: Object.freeze({
    width: 1024,
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
  [RealtimeModel.x2_1_1_preview_cn]: specification,
  [RealtimeModel.x2_1_1_preview_us]: Object.freeze({
    ...specification,
    displayName: 'X2.1.1-preview-us',
  }),
});

/**
 * The camera format for the default model.
 */
export const defaultCameraVideoFormat: RealtimeVideoFormat =
  realtimeModelSpecifications[RealtimeModel.x2_1_1_preview_cn]
    .defaultCameraVideoFormat;
