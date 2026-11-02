import UIKit
import Capacitor

/// Lo mismo que GoSharePlugin.java en Android: entrega a la app el comprobante que dejó la extensión
/// de compartir (ios/App/GoShareExtension) y abre los ajustes de notificaciones.
@objc(GoSharePlugin)
public class GoSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoSharePlugin"
    public let jsName = "GoShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSharedFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise)
    ]

    private static let appGroup = "group.com.godelivery.magdalena.share"
    private static let maxBytes = 15 * 1024 * 1024

    private var inbox: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GoSharePlugin.appGroup)?
            .appendingPathComponent("shared", isDirectory: true)
    }
    private var metaURL: URL? { inbox?.appendingPathComponent("pending.json") }

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func appBecameActive() {
        guard let meta = metaURL, FileManager.default.fileExists(atPath: meta.path) else { return }
        notifyListeners("shared", data: [:], retainUntilConsumed: true)
    }

    @objc func getSharedFile(_ call: CAPPluginCall) {
        guard let meta = metaURL, let inbox = inbox,
              let raw = try? Data(contentsOf: meta),
              let info = try? JSONSerialization.jsonObject(with: raw) as? [String: String],
              let fileName = info["file"] else {
            call.resolve([:])
            return
        }
        let fileURL = inbox.appendingPathComponent(fileName)
        defer {
            try? FileManager.default.removeItem(at: meta)
            try? FileManager.default.removeItem(at: fileURL)
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            call.reject("No se pudo leer el archivo")
            return
        }
        if data.count > GoSharePlugin.maxBytes {
            call.resolve(["tooLarge": true])
            return
        }
        call.resolve([
            "name": info["name"] ?? "comprobante",
            "type": info["type"] ?? "application/octet-stream",
            "base64": data.base64EncodedString()
        ])
    }

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var target = UIApplication.openSettingsURLString
            if #available(iOS 16.0, *) { target = UIApplication.openNotificationSettingsURLString }
            guard let url = URL(string: target) else {
                call.reject("No se pudieron abrir los ajustes")
                return
            }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("No se pudieron abrir los ajustes") }
            }
        }
    }
}

/// Los plugins propios de la app se registran acá (Main.storyboard usa esta clase).
class GoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GoSharePlugin())
        bridge?.registerPluginInstance(GoNativePlugin())
        if let router = bridge?.notificationRouter { GoNotificationProxy.shared.attach(router) }
    }
}
