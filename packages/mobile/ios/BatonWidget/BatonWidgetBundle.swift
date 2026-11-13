import SwiftUI
import WidgetKit

@main
struct BatonWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            BatonLiveActivityWidget()
        }
    }
}
