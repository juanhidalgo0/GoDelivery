# 🛵 GoDelivery Magdalena — Bot de WhatsApp 24/7 (100% Autónomo)

Servidor autónomo del bot de WhatsApp para **GoDelivery Magdalena** con **persistencia de sesión en Firebase Firestore**, **notificaciones push de estado en tiempo real** y **chat de soporte humano bidireccional**.

---

## 🌟 Características Principales

1. **⚡ Persistencia en Firestore:** Las credenciales y claves criptográficas de la sesión se guardan automáticamente en la nube (`whatsapp_bot_sessions`). **Escaneás el QR una sola vez** y podés reiniciar el servidor las veces que quieras sin perder la conexión.
2. **🔔 Notificaciones Push de Pedidos en Vivo:**
   - **Repartidor Asignado (`accepted`):** Avisa al cliente quién es el repartidor y envía el link de seguimiento en vivo con GPS en el mapa.
   - **En Camino (`on_way`):** Avisa que el repartidor ya retiró el pedido y se dirige a su domicilio.
   - **Repartidor Afuera (`arrived`):** Avisa al cliente que el repartidor está en la puerta.
   - **Entregado (`completed`):** Envía el mensaje de agradecimiento.
   - **Cancelado (`cancelled`):** Notifica con el motivo y contacto de soporte.
3. **💬 Soporte Humano Bidireccional:**
   - Si el usuario pide hablar con un humano (Opción 4), se abre un ticket en el panel web del Administrador (`/#/admin/support-chats` o `/#/admin/whatsapp-bot`).
   - Cuando el Administrador contesta desde la web de GoDelivery, el bot **despacha la respuesta al WhatsApp del cliente al instante**.
4. **🍔 Directorio Dinámico de Comercios Abiertos:**
   - Consulta los comercios abiertos en tiempo real en Magdalena (`comercios` con `isOpen === true`) y muestra sus categorías (Pizzerías, Hamburgueserías, Kioscos, etc.).
5. **🛍️ Registro de Mandados / GoFavores:**
   - Recoge origen, destino y detalle del pedido, calcula la tarifa base oficial (`settings/global`) y publica el pedido inmediatamente en el radar de repartidores.
6. **📱 Visor Web de Código QR y Control:**
   - Entrando a la URL del servidor (`http://localhost:3000` o en la nube), contás con un panel de control con el código QR, estado de conexión y uptime.
7. **💓 Keep-Alive Anti-Sleep:**
   - Auto-ping periódico para mantener la instancia 24/7 activa en planes gratuitos de Koyeb o Render.

---

## 🧪 Guía de Pruebas y Testing Paso a Paso

### 1. Iniciar el Servidor Localmente
```bash
cd whatsapp-bot
npm start
```
Verás en la consola:
`🌐 [Web Server] Panel web y Healthcheck corriendo en http://localhost:3000`

### 2. Vincular tu Teléfono (Escaneo de QR)
1. Abrí `http://localhost:3000` en tu navegador.
2. En tu celular, abrí **WhatsApp** > **Dispositivos Vinculados** > **Vincular un dispositivo**.
3. Escaneá el QR en pantalla.
4. El panel web cambiará a **`🟢 CONECTADO como +[TuNúmero]`**.

### 3. Probar Flujos de Usuario (Desde otro WhatsApp)
Escribí al número del bot desde otro teléfono:
- **Menú:** Mandá `Hola` o `Menu`. El bot responderá con el menú de 5 opciones.
- **Mandado:** Mandá `1`. Completá el origen, destino y detalle. El bot generará la orden y te dará el link de seguimiento.
- **Comercios:** Mandá `2`. Verás la lista de negocios abiertos en Magdalena.
- **Consultar Pedido:** Mandá `3`. Verás el estado de tus pedidos en curso.
- **Soporte Humano:** Mandá `4` y un mensaje. Verás el mensaje reflejado en el Panel Admin de GoDelivery. Cuando el Admin responda desde la web, te llegará al WhatsApp al instante.

### 4. Probar Notificaciones Push de Estado
1. Tomá el pedido creado en el paso anterior desde la app de Repartidores (`/#/delivery`).
2. Al **Aceptar**, **Marcar En Camino** o **Entregar**, el bot enviará automáticamente los avisos de estado por WhatsApp con el link del mapa en vivo.

---

## 🚀 Despliegue Gratuito 24/7 en Koyeb (Recomendado)

1. Creá una cuenta en [koyeb.com](https://www.koyeb.com).
2. Hacé clic en **"Create App"** y seleccioná tu repositorio de GitHub.
3. En **Root Directory**, seleccioná `whatsapp-bot`.
4. En **Instance Type**, seleccioná **Eco Free**.
5. En **Environment Variables**, agregá:
   - `FIREBASE_PROJECT_ID`: `godelivery-magdalena`
   - `SESSION_NAME`: `godelivery_main_bot`
   - `APP_URL`: `https://godelivery-magdalena.web.app`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: Todo el contenido JSON de `serviceAccountKey.json`.
6. Abrí la URL pública que te da Koyeb, escaneá el QR y el bot quedará funcionando 24/7.

