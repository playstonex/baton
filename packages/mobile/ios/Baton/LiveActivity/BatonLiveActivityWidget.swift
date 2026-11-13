import Foundation
import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
public struct BatonLiveActivityWidget: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: BatonActivityAttributes.self) { context in
            BatonLiveActivityLockScreenView(
                state: context.state,
                sessionTitle: context.attributes.sessionTitle
            )
            .activityBackgroundTint(Color(red: 0.08, green: 0.09, blue: 0.11))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "baton://agent/\(context.attributes.sessionId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        Image(systemName: statusIcon(for: context.state.status))
                            .foregroundColor(statusColor(for: context.state.status))
                        Text(context.state.verb)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white)
                    }
                    .padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(formatDuration(ms: context.state.durationMs))
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.secondary)
                        .padding(.trailing, 8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        if !context.state.target.isEmpty {
                            Text(context.state.target)
                                .font(.caption)
                                .lineLimit(1)
                                .foregroundColor(.primary)
                        }
                        if context.state.fileChangesCount > 0 {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.badge.plus")
                                    .font(.caption2)
                                Text("\(context.state.fileChangesCount) file(s) modified")
                                    .font(.caption2)
                            }
                            .foregroundColor(.secondary)
                        }
                        if context.state.status == "waiting_input" {
                            HStack(spacing: 8) {
                                Link(destination: URL(string: "baton://agent/\(context.attributes.sessionId)?action=approve")!) {
                                    Text("Approve")
                                        .font(.caption.weight(.bold))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 5)
                                        .background(Color.green.opacity(0.85))
                                        .cornerRadius(6)
                                        .foregroundColor(.white)
                                }
                                Link(destination: URL(string: "baton://agent/\(context.attributes.sessionId)?action=reject")!) {
                                    Text("Reject")
                                        .font(.caption.weight(.bold))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 5)
                                        .background(Color.red.opacity(0.85))
                                        .cornerRadius(6)
                                        .foregroundColor(.white)
                                }
                            }
                            .padding(.top, 4)
                        }
                    }
                    .padding(.horizontal, 8)
                }
            } compactLeading: {
                Image(systemName: statusIcon(for: context.state.status))
                    .foregroundColor(statusColor(for: context.state.status))
            } compactTrailing: {
                Text(context.state.verb.prefix(4))
                    .font(.caption2.weight(.semibold))
            } minimal: {
                Image(systemName: statusIcon(for: context.state.status))
                    .foregroundColor(statusColor(for: context.state.status))
            }
            .keylineTint(statusColor(for: context.state.status))
            .widgetURL(URL(string: "baton://agent/\(context.attributes.sessionId)"))
        }
    }

    private func statusIcon(for status: String) -> String {
        switch status {
        case "waiting_input": return "exclamationmark.triangle.fill"
        case "error": return "xmark.circle.fill"
        case "completed": return "checkmark.circle.fill"
        default: return "sparkles"
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "waiting_input": return .yellow
        case "error": return .red
        case "completed": return .green
        default: return .blue
        }
    }

    private func formatDuration(ms: Int) -> String {
        let sec = ms / 1000
        if sec < 60 { return "\(sec)s" }
        return "\(sec / 60)m \(sec % 60)s"
    }
}

@available(iOS 16.1, *)
public struct BatonLiveActivityLockScreenView: View {
    let state: BatonActivityAttributes.ContentState
    let sessionTitle: String

    public var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "terminal.fill")
                .font(.title2)
                .foregroundColor(.blue)

            VStack(alignment: .leading, spacing: 3) {
                Text(sessionTitle)
                    .font(.headline)
                    .lineLimit(1)
                    .foregroundColor(.white)

                Text("\(state.verb): \(state.target.isEmpty ? state.title : state.target)")
                    .font(.subheadline)
                    .lineLimit(1)
                    .foregroundColor(.secondary)

                if state.fileChangesCount > 0 {
                    Text("\(state.fileChangesCount) file(s) modified")
                        .font(.caption2)
                        .foregroundColor(.green)
                }
            }

            Spacer()

            if state.status == "waiting_input" {
                VStack(spacing: 4) {
                    Text("Approval")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.yellow.opacity(0.3))
                        .foregroundColor(.yellow)
                        .cornerRadius(8)
                }
            }
        }
        .padding(14)
    }
}
