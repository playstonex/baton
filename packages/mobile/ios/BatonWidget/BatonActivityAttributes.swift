import Foundation
import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
public struct BatonActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var title: String           // e.g. "Executing: bash"
        public var verb: String            // "Executing", "Thinking", "Waiting"
        public var target: String          // e.g. "pnpm test"
        public var status: String          // "running" | "waiting_input" | "completed" | "error"
        public var durationMs: Int
        public var fileChangesCount: Int
        public var sessionId: String
        public var updatedAt: Date

        public init(
            title: String = "Agent Working",
            verb: String = "Executing",
            target: String = "",
            status: String = "running",
            durationMs: Int = 0,
            fileChangesCount: Int = 0,
            sessionId: String = "",
            updatedAt: Date = Date()
        ) {
            self.title = title
            self.verb = verb
            self.target = target
            self.status = status
            self.durationMs = durationMs
            self.fileChangesCount = fileChangesCount
            self.sessionId = sessionId
            self.updatedAt = updatedAt
        }
    }

    public var sessionTitle: String
    public var sessionId: String

    public init(sessionTitle: String, sessionId: String) {
        self.sessionTitle = sessionTitle
        self.sessionId = sessionId
    }
}
