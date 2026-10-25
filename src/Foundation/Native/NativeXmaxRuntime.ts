//
//  NativeXmaxRuntime.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  TurboModuleRegistry,
  type TurboModule,
  type CodegenTypes,
} from 'react-native';

/**
 * The Codegen interface for permissions, native media resources, and runtime metadata.
 */
export interface Spec extends TurboModule {

  /**
   * Updates global category filtering shared by JS and native logging.
   *
   * @param options The SDK log-category bitmask; 0 disables logging.
   */
  configureLogging(
    options: number
  ): void;

  /**
   * Writes formatted logs to OSLog or Logcat without triggering LogBox.
   *
   * @param level The log severity.
   * @param message The formatted log message.
   * @param option The current message's log-category bitmask.
   */
  writeLog(
    level: string,
    message: string,
    option: number
  ): void;

  /**
   * Hides a matching SDK video container on the native UI thread before RTC cleanup.
   *
   * Completes after hiding the matching view, or immediately if it is already unmounted.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   */
  hideVideoContainer(
    reactTag: number,
    nativeID: string
  ): Promise<void>;

  /**
   * Submits drawing commands to the current native canvas; animation runs on the UI thread.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   * @param command The serialized trajectory drawing command.
   */
  renderTrajectory(
    reactTag: number,
    nativeID: string,
    command: string
  ): void;

  /**
   * Atomically replaces a destination with a completed temporary download in the same directory.
   *
   * Completes after atomic replacement; failure preserves the existing destination.
   *
   * @param sourcePath The absolute path of the completed temporary file.
   * @param destinationPath The absolute destination path in the temporary file's directory.
   */
  replaceFile(
    sourcePath: string,
    destinationPath: string
  ): Promise<void>;

  /**
   * Requests the specified media permission without starting capture.
   *
   * @param permission The camera or microphone permission to request.
   * @returns Whether the requested access is authorized.
   */
  requestMediaPermission(
    permission: string
  ): Promise<boolean>;

  /**
   * Reads orientation-corrected image dimensions without passing pixels to JS.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @returns JSON containing the orientation-corrected integer image dimensions.
   */
  imageInfo(
    fileURL: string
  ): Promise<string>;

  /**
   * Reads orientation-corrected video file dimensions independently of realtime media ownership.
   *
   * @param fileURL The readable local video file URL.
   * @returns Serialized display width and height, in pixels.
   */
  videoInfo(
    fileURL: string
  ): Promise<string>;

  /**
   * Corrects orientation, center-crops to the target ratio, and saves a private JPEG copy.
   *
   * @param fileURL The readable local file URL; your app retains ownership of the original.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   * @returns The private JPEG URL; removePreparedImage() only deletes SDK-owned copies.
   */
  prepareImage(
    fileURL: string,
    width: number,
    height: number
  ): Promise<string>;

  /**
   * Deletes only an image copy created by prepareImage.
   *
   * Completes after copy removal; rejects invalid or unowned paths.
   *
   * @param fileURL The SDK-owned private image copy URL returned by image preparation.
   */
  removePreparedImage(
    fileURL: string
  ): Promise<void>;

  /**
   * Native RTC events containing safe scalar metadata and media ownership identity.
   */
  readonly onRtcEvent: CodegenTypes.EventEmitter<string>;

  /**
   * Dispatches validated RTC operations; TypeScript owns business signaling.
   *
   * @param owner The owner identity; retired owners cannot modify replacement resources.
   * @param request The serialized RTC operation and validated parameters.
   * @returns The native JSON result; rejects invalid ownership or operation failure.
   */
  rtcCommand(
    owner: string,
    request: string
  ): Promise<string>;

  /**
   * Registers a mounted Fabric view as an RTC canvas container.
   *
   * Completes after mount identity validation and registration. On iOS, VIEW_NOT_MOUNTED permits
   * a bounded retry while Fabric publishes the view; other failures reject an unavailable
   * registry or a different mount identity.
   *
   * @param reactTag The mounted container's React Native tag.
   * @param nativeID The native mount identity excluding removed or recycled views.
   */
  registerVideoSurface(
    reactTag: number,
    nativeID: string
  ): Promise<void>;

  /**
   * Unregisters only the specified mount identity without affecting replacement views.
   *
   * @param nativeID The native mount identity excluding removed or recycled views.
   */
  unregisterVideoSurface(
    nativeID: string
  ): void;

  /**
   * Refreshes native UI state asynchronously before media acquisition.
   *
   * Completes after foreground-state refresh; rejects after runtime destruction.
   */
  prepareRuntime(): Promise<void>;

  /**
   * Attempts exclusive media acquisition while the app is foregrounded.
   *
   * @param owner The owner identity; retired owners cannot modify replacement resources.
   * @returns Whether exclusive foreground media ownership was acquired.
   */
  acquire(
    owner: string
  ): boolean;

  /**
   * Checks that media ownership is active and has not been invalidated by backgrounding.
   *
   * @param owner The owner identity; retired owners cannot modify replacement resources.
   * @returns Whether the resource owner or current task remains active.
   */
  isActive(
    owner: string
  ): boolean;

  /**
   * Releases only the matching media owner; stale or repeated calls cannot release another owner.
   *
   * @param owner The owner identity; retired owners cannot modify replacement resources.
   */
  release(
    owner: string
  ): void;

  /**
   * Creates a UUID for a stream, operation, or media owner.
   */
  randomUUID(): string;

  /**
   * Serializes platform, system version, and device model for service requests.
   */
  runtimeInfo(): string;
}

export default TurboModuleRegistry.getEnforcing<Spec>('XmaxRuntime');
