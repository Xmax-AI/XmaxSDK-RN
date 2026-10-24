//
//  XmaxRuntime.mm
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

#import "XmaxRuntime.h"
#import "XmaxReactNativeSDK-Swift.h"
#import <React/RCTInvalidating.h>
#import <React/RCTViewComponentView.h>

/**
 * A bridge that connects the SDK native runtime and RTC events to React Native.
 */
@interface XmaxRuntime () <RCTInvalidating>

/**
 * The native runtime implementation responsible for media resources and asynchronous operations.
 */
@property(nonatomic, strong) XmaxRuntimeImplementation *implementation;
@end

@implementation XmaxRuntime
RCT_EXPORT_MODULE(XmaxRuntime)
@synthesize viewRegistry_DEPRECATED = _viewRegistry_DEPRECATED;

/**
 * Declares that module construction does not require UI access.
 *
 * @returns NO; reading view state on the main thread is not required.
 */
+ (BOOL)requiresMainQueueSetup {
  return NO;
}

/**
 * Selects the main queue for asynchronous bridge operations that access media or views.
 */
- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

/**
 * Creates the Swift runtime and forwards scalar RTC metadata through the generated event interface.
 */
- (instancetype)init {
  if ((self = [super init])) {
    self.implementation = [XmaxRuntimeImplementation new];
    __weak XmaxRuntime *weakSelf = self;
    self.implementation.eventSink = ^(NSString *message) { [weakSelf emitOnRtcEvent:message]; };
  }

  return self;
}

/**
 * Releases media resources and callback references when React Native invalidates the module.
 */
- (void)invalidate {
  [self.implementation invalidate];
}

/**
 * Refreshes the native foreground state before media lease acquisition.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)prepareRuntime:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation prepareRuntime:resolve reject:reject];
}

/**
 * Attempts to acquire an exclusive foreground media lease for the specified identifier.
 *
 * @param owner The owner identity; retired owners cannot modify replacement resources.
 * @returns Whether exclusive foreground media ownership was acquired.
 */
- (NSNumber *)acquire:(NSString *)owner {
  return [self.implementation acquire:owner];
}

/**
 * Checks whether the specified identifier still holds a valid media lease.
 *
 * @param owner The owner identity; retired owners cannot modify replacement resources.
 */
- (NSNumber *)isActive:(NSString *)owner {
  return [self.implementation isActive:owner];
}

/**
 * Releases only the matching native media owner after resources stop.
 *
 * @param owner The owner identity; retired owners cannot modify replacement resources.
 */
- (void)release:(NSString *)owner {
  [self.implementation release:owner];
}

/**
 * Generates a unique identifier for an SDK media owner or operation.
 */
- (NSString *)randomUUID {
  return [self.implementation randomUUID];
}

/**
 * Serializes platform, operating system, and device metadata as JSON.
 */
- (NSString *)runtimeInfo {
  return [self.implementation runtimeInfo];
}

/**
 * Applies global category filtering to native logs.
 *
 * @param options The SDK log-category bitmask; 0 disables logging.
 */
- (void)configureLogging:(double)options {
  [self.implementation configureLogging:options];
}

/**
 * Writes an enabled, formatted log entry to native output.
 *
 * @param level The log level: debug, info, warn, or error.
 * @param message The formatted log message.
 * @param option The current message's log-category bitmask.
 */
- (void)writeLog:(NSString *)level
    message:(NSString *)message
    option:(double)option {
  [self.implementation writeLog:level message:message option:option];
}

// The React Native adapter resolves registered views; Swift performs view updates.

/**
 * Validates the mount identifier and hides the remote layer before RTC cleanup.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param reactTag The mounted container's React Native tag.
 * @param nativeID The native mount identity excluding removed or recycled views.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)hideVideoContainer:(double)reactTag
    nativeID:(NSString *)nativeID
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  __weak RCTViewRegistry *registry = self.viewRegistry_DEPRECATED;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = [registry viewForReactTag:@(reactTag)];
    // Fabric stores the mount identifier in nativeId; validate it before modifying a potentially reused React tag.
    if ([view isKindOfClass:[RCTViewComponentView class]] &&
        [((RCTViewComponentView *)view).nativeId isEqualToString:nativeID]) {
      [self.implementation hideVideoContainer:view];
    }
    resolve(nil);
  });
}

/**
 * Sends drawing commands only to a container with a matching mount identifier.
 *
 * @param reactTag The mounted container's React Native tag.
 * @param nativeID The native mount identity excluding removed or recycled views.
 * @param command The serialized trajectory drawing command.
 */
- (void)renderTrajectory:(double)reactTag
    nativeID:(NSString *)nativeID
    command:(NSString *)command {
  __weak RCTViewRegistry *registry = self.viewRegistry_DEPRECATED;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = [registry viewForReactTag:@(reactTag)];
    if ([view isKindOfClass:[RCTViewComponentView class]] &&
        [((RCTViewComponentView *)view).nativeId isEqualToString:nativeID]) {
      [XmaxTrajectoryView renderIn:view command:command];
    }
  });
}

/**
 * Requests camera and microphone permissions without starting media capture.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param useMicrophone Whether to request microphone permission and publish audio; false disables
 *   audio.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)requestPermissions:(BOOL)useMicrophone
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation requestPermissions:useMicrophone resolve:resolve reject:reject];
}

/**
 * Atomically replaces a completed download's destination without changing realtime media ownership.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param sourcePath The absolute path of the completed temporary file.
 * @param destinationPath The absolute destination path in the temporary file's directory.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)replaceFile:(NSString *)sourcePath
    destinationPath:(NSString *)destinationPath
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation replaceFile:sourcePath destinationPath:destinationPath resolve:resolve reject:reject];
}

/**
 * Reads orientation-corrected local image dimensions without returning native pixels.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param fileURL The readable local file URL; your app retains ownership of the original.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)imageInfo:(NSString *)fileURL
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation imageInfo:fileURL resolve:resolve reject:reject];
}

/**
 * Creates an SDK-owned upright JPEG at the target dimensions without modifying the original file.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param fileURL The readable local file URL; your app retains ownership of the original.
 * @param width The width, in pixels.
 * @param height The height, in pixels.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)prepareImage:(NSString *)fileURL
    width:(double)width
    height:(double)height
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation prepareImage:fileURL width:width height:height resolve:resolve reject:reject];
}

/**
 * Deletes only private copies created by the SDK image service.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param fileURL The readable local file URL; your app retains ownership of the original.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)removePreparedImage:(NSString *)fileURL
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  [self.implementation removePreparedImage:fileURL resolve:resolve reject:reject];
}

/**
 * Validates media ownership before executing an RTC request on the main thread.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param owner The owner identity; retired owners cannot modify replacement resources.
 * @param request The serialized RTC operation and validated parameters.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)rtcCommand:(NSString *)owner
    request:(NSString *)request
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  // Dispatches the RTC operation to the UI queue independently of the JavaScript calling thread.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.implementation rtcCommand:owner request:request resolve:resolve reject:reject];
  });
}

/**
 * Registers a Fabric container only when both its React tag and native mount identifier match.
 *
 * Resolves or rejects the bridge Promise when the native operation completes.
 *
 * @param reactTag The mounted container's React Native tag.
 * @param nativeID The native mount identity excluding removed or recycled views.
 * @param resolve The React Native Promise completion callback for this operation.
 * @param reject The Promise failure callback receiving a stable SDK error code.
 */
- (void)registerVideoSurface:(double)reactTag
    nativeID:(NSString *)nativeID
    resolve:(RCTPromiseResolveBlock)resolve
    reject:(RCTPromiseRejectBlock)reject {
  __weak RCTViewRegistry *registry = self.viewRegistry_DEPRECATED;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = [registry viewForReactTag:@(reactTag)];
    if ([view isKindOfClass:[RCTViewComponentView class]] && [((RCTViewComponentView *)view).nativeId isEqualToString:nativeID]) {
      [self.implementation registerVideoSurface:view nativeID:nativeID];
      resolve(nil);
    } else {
      reject(@"MEDIA_ERROR", @"Video canvas is no longer mounted", nil);
    }
  });
}

/**
 * Unregisters only the specified mounted container identifier.
 *
 * @param nativeID The native mount identity excluding removed or recycled views.
 */
- (void)unregisterVideoSurface:(NSString *)nativeID {
  dispatch_async(dispatch_get_main_queue(), ^{ [self.implementation unregisterVideoSurface:nativeID]; });
}

/**
 * Creates the Codegen-generated JSI adapter that exposes the SDK runtime to JavaScript.
 *
 * @param params The React Native initialization parameters for the generated JSI module.
 * @returns The shared pointer to the SDK JSI module.
 */
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeXmaxRuntimeSpecJSI>(params);
}

@end
