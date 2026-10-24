//
//  VideoRenderRegistry.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  RealtimeMediaStream,
  RealtimeVideoTrack,
} from '../../Service/Realtime/RealtimeTypes';
import type { VideoRenderBinding } from './VideoRenderBinding';

/**
 * The weak registry from public video tracks to render bindings.
 */
const tracks = new WeakMap<RealtimeVideoTrack, VideoRenderBinding>();

/**
 * The weak registry from public streams to local or remote bindings.
 */
const streams = new WeakMap<RealtimeMediaStream, VideoRenderBinding>();

/**
 * Registers a stream and its video track with their shared rendering state.
 *
 * @param stream The manager-owned media stream.
 * @param track The stable video track exposed by the stream.
 * @param binding The rendering state owned by the creating controller.
 */
export function registerVideoRenderBinding(
  stream: RealtimeMediaStream,
  track: RealtimeVideoTrack,
  binding: VideoRenderBinding,
): void {
  tracks.set(
    track,
    binding
  );
  streams.set(
    stream,
    binding
  );
}

/**
 * Looks up the rendering state of a manager-owned media stream.
 *
 * @param stream The local or remote media stream to inspect.
 * @returns The registered binding, or null when the stream was not created by XmaxSDK.
 */
export function streamBinding(
  stream: RealtimeMediaStream,
): VideoRenderBinding | null {
  return streams.get(stream) ?? null;
}

/**
 * Looks up a track binding without creating one.
 *
 * @param track The video track to look up.
 * @returns The binding, or null if the track is absent or not owned by the SDK.
 */
export function videoBinding(
  track: RealtimeVideoTrack | null | undefined,
): VideoRenderBinding | null {
  return track ? tracks.get(track) ?? null : null;
}

/**
 * Notifies mounted video components of binding changes while preserving track identity.
 *
 * @param binding The binding used for rendering, interaction, and cleanup.
 */
export function refreshBinding(
  binding: VideoRenderBinding
): void {
  binding.version++;

  for (const listener of [...binding.listeners]) listener();
}
