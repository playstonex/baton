import Foundation
import ActivityKit
import React

@objc(BatonLiveActivityModule)
public class BatonLiveActivityModule: NSObject {
    @objc
    public static func requiresMainQueueSetup() -> Bool { true }

    private var currentActivityId: String?

    @objc
    public func startLiveActivity(
        _ sessionTitle: String,
        sessionId: String,
        state: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            resolve(nil)
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            resolve(nil)
            return
        }

        let attributes = BatonActivityAttributes(sessionTitle: sessionTitle, sessionId: sessionId)
        let contentState = parseContentState(state, sessionId: sessionId)
        let content = ActivityContent(state: contentState, staleDate: nil)

        do {
            let activity = try Activity<BatonActivityAttributes>.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            self.currentActivityId = activity.id
            resolve(activity.id)
        } catch {
            reject("LIVE_ACTIVITY_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    public func updateLiveActivity(
        _ state: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            resolve(nil)
            return
        }

        Task {
            guard let activity = Activity<BatonActivityAttributes>.activities.first else {
                resolve(nil)
                return
            }
            let contentState = self.parseContentState(state, sessionId: activity.attributes.sessionId)
            let content = ActivityContent(state: contentState, staleDate: nil)
            await activity.update(content)
            resolve(activity.id)
        }
    }

    @objc
    public func endLiveActivity(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            resolve(nil)
            return
        }

        Task {
            for activity in Activity<BatonActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            self.currentActivityId = nil
            resolve(true)
        }
    }

    @available(iOS 16.1, *)
    private func parseContentState(_ dict: NSDictionary, sessionId: String) -> BatonActivityAttributes.ContentState {
        return BatonActivityAttributes.ContentState(
            title: dict["title"] as? String ?? "Agent Working",
            verb: dict["verb"] as? String ?? "Executing",
            target: dict["target"] as? String ?? "",
            status: dict["status"] as? String ?? "running",
            durationMs: dict["durationMs"] as? Int ?? 0,
            fileChangesCount: dict["fileChangesCount"] as? Int ?? 0,
            sessionId: sessionId,
            updatedAt: Date()
        )
    }
}
