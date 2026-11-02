import UIKit
import Capacitor
import StoreKit
import UserNotifications

/// Lo mismo que GoNativePlugin.java en Android (src/utils/native.js): vibraciones cortas y el cartel
/// de Apple para calificar la app.
@objc(GoNativePlugin)
public class GoNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoNativePlugin"
    public let jsName = "GoNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async {
            switch kind {
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    /// Apple decide si lo muestra (como mucho 3 veces por año): siempre resuelve.
    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let scene = UIApplication.shared.connectedScenes
                .first { $0.activationState == .foregroundActive } as? UIWindowScene
            if let scene = scene {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }
}

/// Responder un chat desde la notificación sin abrir la app. Se pone delante del que reparte las
/// notificaciones de Capacitor: "Responder" lo resuelve acá (manda el texto a chatReplyFromPush con
/// el pase que trae la push) y todo lo demás sigue igual que antes.
final class GoNotificationProxy: NSObject, UNUserNotificationCenterDelegate {
    static let shared = GoNotificationProxy()
    static let replyAction = "CHAT_REPLY"
    static let chatCategory = "GO_CHAT"

    private weak var next: UNUserNotificationCenterDelegate?
    // Toques que llegan antes de que cargue Capacitor: se le pasan cuando aparece
    private var waiting: [(UNNotificationResponse, () -> Void)] = []

    /// Al abrir la app, antes de que iOS entregue la respuesta (AppDelegate).
    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Cuando carga Capacitor (GoBridgeViewController), que se puso él como delegado.
    func attach(_ router: UNUserNotificationCenterDelegate) {
        next = router
        UNUserNotificationCenter.current().delegate = self
        let pending = waiting
        waiting = []
        pending.forEach { router.userNotificationCenter?(UNUserNotificationCenter.current(), didReceive: $0.0, withCompletionHandler: $0.1) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let next = next {
            next.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else {
            completionHandler([.banner, .list, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if response.actionIdentifier == GoNotificationProxy.replyAction, let input = response as? UNTextInputNotificationResponse {
            sendReply(input.userText, info: info, completion: completionHandler)
            return
        }
        // El aviso de que no se pudo enviar: abre el chat como un link
        if let link = info["goOpenUrl"] as? String, let url = URL(string: link) {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
            completionHandler()
            return
        }
        if let next = next {
            next.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        } else {
            waiting.append((response, completionHandler))
        }
    }

    private func sendReply(_ raw: String, info: [AnyHashable: Any], completion: @escaping () -> Void) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty,
              let token = info["replyToken"] as? String,
              let endpoint = info["replyUrl"] as? String,
              endpoint.hasPrefix("https://"),
              let url = URL(string: endpoint) else {
            completion()
            return
        }
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "text": text])
        let chatUrl = info["url"] as? String
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            if !ok { GoNotificationProxy.notifyFailure(chatUrl) }
            DispatchQueue.main.async {
                completion()
                if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
            }
        }.resume()
    }

    private static func notifyFailure(_ chatUrl: String?) {
        let content = UNMutableNotificationContent()
        content.title = "No se pudo enviar tu respuesta"
        content.body = "Tocá para abrir el chat y probar de nuevo."
        if let chatUrl = chatUrl { content.userInfo = ["goOpenUrl": chatUrl] }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
