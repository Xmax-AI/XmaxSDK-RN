#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(XLabRemoteMediaFrames, NSObject)
RCT_EXTERN_METHOD(createConsumer:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getStatistics:(NSString *)handle
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(releaseConsumer:(NSString *)handle
                         resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject)
@end
