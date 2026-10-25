//
//  XmaxRealtimeFactory.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { PermissionManager } from '../../Foundation/Permissions/PermissionManager';
import { RealtimeTiming } from '../../Service/Realtime/RealtimeTiming';
import { RtcManager } from '../../Foundation/RTC/RtcManager';
import type { RtcManaging } from '../../Foundation/RTC/RtcManaging';
import { ImageManager } from '../../Foundation/Media/ImageManager';
import { MediaController } from '../../Media/MediaController';
import type { MediaControlling } from '../../Media/MediaControlling';
import { CameraController } from '../../Media/Camera/CameraController';
import { ExternalVideoController } from '../../Media/External/ExternalVideoController';
import { ImageController } from '../../Media/Image/ImageController';
import { InteractionController } from '../../Media/Interaction/InteractionController';
import { RenderController } from '../../Render/RenderController';
import type { RenderControlling } from '../../Render/RenderControlling';
import { StreamController } from '../../Stream/StreamController';
import type { StreamControlling } from '../../Stream/StreamControlling';
import { RoomController } from '../../Stream/Room/RoomController';
import { EncodingController } from '../../Stream/Encoding/EncodingController';
import { QualityController } from '../../Stream/Quality/QualityController';
import { MediaService } from '../../Service/Media/MediaService';
import type { MediaServicing } from '../../Service/Media/MediaServicing';
import { ApiService } from '../../Service/Network/ApiService';
import { RealtimeSessionService } from '../../Service/Realtime/RealtimeSessionService';
import type { RealtimeConfiguration } from './RealtimeConfiguration';
import { realtimeAPIBaseURL } from '../XmaxEnvironment';
import type { XmaxConfiguration } from '../XmaxConfiguration';
import { XmaxRealtimeConnectionManager } from './XmaxRealtimeConnectionManager';
import { XmaxRealtimeGenerationManager } from './XmaxRealtimeGenerationManager';
import { XmaxRealtimeErrorManager } from './XmaxRealtimeErrorManager';
import {
  XmaxRealtimeLifecycleManager,
  type TerminationScope,
} from './XmaxRealtimeLifecycleManager';

/**
 * The dependencies shared by a realtime facade and its lifecycle manager.
 */
export interface XmaxRealtimeDependencies {

  /**
   * The shared generation startup timer; omission disables component-level timing.
   */
  readonly timing?: RealtimeTiming;

  /**
   * The manager owning the server session and RTC connection.
   */
  readonly connectionManager: XmaxRealtimeConnectionManager;

  /**
   * The manager owning generation signaling and cached conditions.
   */
  readonly generationManager: XmaxRealtimeGenerationManager;

  /**
   * The manager normalizing and forwarding runtime failures.
   */
  readonly errorManager: XmaxRealtimeErrorManager;

  /**
   * The controller owning local media and task interactions.
   */
  readonly mediaController: MediaControlling;

  /**
   * The controller owning video bindings and result visibility.
   */
  readonly renderController: RenderControlling;

  /**
   * The controller owning room signaling, encoding, and transport quality.
   */
  readonly streamController: StreamControlling;

  /**
   * The shared model sizing and capability service.
   */
  readonly mediaService: MediaServicing;

  /**
   * The native RTC resource and normalized event interface.
   */
  readonly rtcManager: RtcManaging;
}

/**
 * The configured components used by a realtime facade and its lifecycle manager.
 */
export interface XmaxRealtimeComponents extends XmaxRealtimeDependencies {

  /**
   * The shared owner of operation admission, state, cancellation, and cleanup.
   */
  readonly lifecycleManager: XmaxRealtimeLifecycleManager;
}

/**
 * Creates realtime components and wires preview, failure, and cleanup callbacks.
 */
export class XmaxRealtimeFactory {

  /**
   * Creates the default components for a realtime manager without acquiring native media.
   *
   * @param configuration The validated credentials, environment, and optional API root override.
   * @param options The realtime model configuration.
   * @returns The components sharing one RTC adapter and lifecycle manager.
   */
  static make(
    configuration: Readonly<Required<XmaxConfiguration>>,
    options: RealtimeConfiguration,
  ): XmaxRealtimeComponents {
    const timing = new RealtimeTiming();
    const rtcManager = new RtcManager();
    const errorManager = new XmaxRealtimeErrorManager();
    const mediaService = new MediaService(options.model);
    const roomController = new RoomController(
      rtcManager,
      timing
    );
    const interactionController = new InteractionController((taskID, points) =>
      roomController.sendTracks(
        taskID,
        points
      ),
    );
    const renderController = new RenderController(
      {},
      rtcManager,
      interactionController,
    );
    const mediaController = new MediaController(
      new CameraController(
        rtcManager,
        renderController,
        mediaService,
        new PermissionManager(),
      ),
      new ImageController(
        rtcManager,
        renderController,
        mediaService,
        new ImageManager(),
      ),
      interactionController,
      new ExternalVideoController(
        rtcManager,
        renderController,
        mediaService,
        error => errorManager.forward(
          error,
          'all'
        ),
      ),
    );
    const streamController = new StreamController(
      rtcManager,
      roomController,
      new EncodingController(rtcManager),
      new QualityController(rtcManager),
      timing,
    );
    const generationManager = new XmaxRealtimeGenerationManager(
      rtcManager,
      streamController,
      mediaController,
      renderController,
      timing,
    );
    const connectionManager = new XmaxRealtimeConnectionManager(
      new RealtimeSessionService(
        new ApiService(
          configuration.apiKey,
          configuration.baseURL ??
            realtimeAPIBaseURL(configuration.environment),
          rtcManager.runtime,
        ),
      ),
      roomController,
      renderController,
      timing,
    );

    return this.assemble({
      timing,
      connectionManager,
      generationManager,
      errorManager,
      mediaController,
      renderController,
      streamController,
      mediaService,
      rtcManager,
    });
  }

  /**
   * Connects supplied components to shared failure handling and ordered resource cleanup.
   *
   * @param dependencies The components whose ownership and cleanup belong to this lifecycle.
   * @returns The components with operation admission, failure forwarding, and cleanup configured.
   */
  static assemble(
    dependencies: XmaxRealtimeDependencies,
  ): XmaxRealtimeComponents {
    const {
      connectionManager,
      generationManager,
      errorManager,
      mediaController,
      renderController,
      streamController,
      rtcManager,
    } = dependencies;
    let disconnectCleanup: Promise<void> | null = null;
    const disconnect = (): Promise<void> => {
      if (disconnectCleanup) return disconnectCleanup;
      const cleanup = (async () => {
        await renderController.hideRemote();
        try {
          await generationManager.reset();
        } finally {
          try {
            await connectionManager.disconnect();
          } finally {
            streamController.quality.reset();
            errorManager.invalidatePendingFailures('connection');
            lifecycleManager.didCleanup('connection');
          }
        }
      })();
      const completion = cleanup.finally(() => {
        if (disconnectCleanup === completion) disconnectCleanup = null;
      });
      disconnectCleanup = completion;
      return completion;
    };
    const cleanup = async (scope: TerminationScope): Promise<void> => {
      if (scope === 'generation') {
        const remote = connectionManager.remoteStream;
        if (remote) renderController.setRemoteStream(
          remote,
          null
        );
        await generationManager.stop();
        return;
      }
      if (scope === 'connection') return disconnect();

      let stopFailure: unknown;
      try {
        await renderController.hideRemote();
        await generationManager.reset();
      } catch (error) {
        stopFailure = error;
      }
      try {
        try {
          await disconnect();
        } finally {
          await mediaController.close();
        }
        if (stopFailure) throw stopFailure;
      } finally {
        renderController.invalidate();
        errorManager.invalidatePendingFailures();
        lifecycleManager.didCleanup('all');
      }
    };
    const lifecycleManager = new XmaxRealtimeLifecycleManager(
      cleanup,
      () => mediaController.stream !== null,
      () => connectionManager.lastSessionID,
      () => rtcManager.stopLocalCapture(),
      errorManager,
    );
    renderController.setPreviewReadyListener(binding => {
      const local = mediaController.stream;
      if (!binding.valid || !local) return;
      try {
        if (binding === renderController.requireLocal(local))
          lifecycleManager.localPreviewDidBecomeReady();
      } catch {
        // Released or replaced local streams cannot make a new preview ready.
      }
    });
    renderController.setBindingFailureListener((binding, error) => {
      if (binding.valid)
        errorManager.forward(
          error,
          binding.local ? 'all' : 'connection'
        );
    });
    errorManager.setFailureHandler((error, target, isCurrent) => {
      if (!isCurrent()) return;
      dependencies.timing?.finishFailure(error);
      mediaController.stopInteraction();
      void lifecycleManager.terminate(
        target,
        { type: 'failure', error }
      );
    });

    return { ...dependencies, lifecycleManager };
  }
}
