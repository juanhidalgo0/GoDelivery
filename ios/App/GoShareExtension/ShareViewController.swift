import UIKit
import UniformTypeIdentifiers

/// Aparece como "GO!" al compartir desde una billetera. Deja el archivo en el contenedor compartido
/// con la app y avisa que se abra GO!: la app lo toma sola al abrirse (GoSharePlugin.swift).
/// Una extensión no puede abrir su app de forma oficial, por eso se le pide a la persona.
class ShareViewController: UIViewController {
    private let appGroup = "group.com.godelivery.magdalena.share"
    private let maxBytes = 15 * 1024 * 1024

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard let provider = firstAttachment() else {
            finish(title: "No se pudo compartir", message: "Solo se pueden mandar fotos o PDF.")
            return
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { [weak self] item, _ in
                self?.store(item, type: "application/pdf", fallbackName: "comprobante.pdf")
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] item, _ in
                self?.store(item, type: "image/jpeg", fallbackName: "comprobante.jpg")
            }
        } else {
            finish(title: "No se pudo compartir", message: "Solo se pueden mandar fotos o PDF.")
        }
    }

    private func firstAttachment() -> NSItemProvider? {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let all = items.flatMap { $0.attachments ?? [] }
        return all.first { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) }
            ?? all.first { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
    }

    private func store(_ item: NSSecureCoding?, type: String, fallbackName: String) {
        var data: Data?
        var name = fallbackName
        if let url = item as? URL {
            data = try? Data(contentsOf: url)
            if !url.lastPathComponent.isEmpty { name = url.lastPathComponent }
        } else if let raw = item as? Data {
            data = raw
        } else if let image = item as? UIImage {
            data = image.jpegData(compressionQuality: 0.85)
        }
        guard let bytes = data, !bytes.isEmpty else {
            finish(title: "No se pudo compartir", message: "No pudimos leer el archivo.")
            return
        }
        guard bytes.count <= maxBytes else {
            finish(title: "Archivo muy grande", message: "El máximo es 15 MB.")
            return
        }
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            finish(title: "No se pudo compartir", message: "Probá de nuevo desde GO!.")
            return
        }
        do {
            let inbox = root.appendingPathComponent("shared", isDirectory: true)
            try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
            let stored = type == "application/pdf" ? "pending.pdf" : "pending.jpg"
            try bytes.write(to: inbox.appendingPathComponent(stored), options: .atomic)
            let meta: [String: String] = ["file": stored, "name": name, "type": type]
            try JSONSerialization.data(withJSONObject: meta).write(to: inbox.appendingPathComponent("pending.json"), options: .atomic)
            finish(title: "Comprobante listo", message: "Abrí GO! y se manda solo al chat de tu pedido.")
        } catch {
            finish(title: "No se pudo compartir", message: "Probá de nuevo.")
        }
    }

    private func finish(title: String, message: String) {
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Entendido", style: .default) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil)
            })
            self.present(alert, animated: true)
        }
    }
}
