#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BatonLiveActivityModule, NSObject)

RCT_EXTERN_METHOD(startLiveActivity:(NSString *)sessionTitle
                  sessionId:(NSString *)sessionId
                  state:(NSDictionary *)state
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateLiveActivity:(NSDictionary *)state
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endLiveActivity:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
