#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(XLabExternalCapture, NSObject)
RCT_EXTERN_METHOD(prepare:(NSString *)fileURL
                  fps:(double)fps
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(start:(NSString *)sourceID
                 sink:(NSString *)sink
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop:(NSString *)sourceID
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
@end
