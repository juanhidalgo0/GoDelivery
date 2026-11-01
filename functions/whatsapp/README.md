# Bot de WhatsApp (API oficial de Meta)

Reemplaza al bot con Baileys de `whatsapp-bot/`. Vive dentro de Cloud Functions: no hay
servidor aparte ni QR que escanear.

## Qué hace

- **Menú con botones y listas.** No usa IA: el cliente toca opciones y escribe texto libre
  donde hace falta.
- **Comprar algo:** es un mandado de compra. El cadete lee la lista tal cual, sea texto,
  audio o foto. Sale del centro, como en la app.
- **Llevar o traer algo:** es una encomienda, de la dirección de retiro a la de entrega.
- **Pedir a un comercio:**
  - Si el comercio tiene catálogo, el bot manda el link a su tienda. El cliente también
    puede elegir escribir el pedido.
  - Si no tiene catálogo, o el cliente prefiere escribir, se crea una consulta en
    `wa_quotes`. Al comercio le suena la alarma del panel y le llega una notificación.
    Responde el precio y el tiempo de preparación, o "No lo tengo".
  - Con precio, el cliente confirma por WhatsApp y el pedido entra ya aceptado
    (`confirmed`).
  - Si el comercio rechaza, o no responde en 10 minutos, se le ofrece al cliente pasarlo a
    mandado con lo que ya contó.
- **Mis pedidos:** muestra el estado de los pedidos en curso. Los que todavía no tomó
  ningún cadete se pueden cancelar desde ahí.
- **Hablar con alguien:** los mensajes van a `support_chats/{número}` y aparecen en el panel
  de soporte. Lo que responde el equipo le llega al cliente por WhatsApp.
- **Si escribe un comercio** (su `phone` coincide con el número), el menú suma
  "Cadete para mi local".
- **Avisos automáticos:** cadete asignado, en camino, llegó, entregado o cancelado. Salen de
  `onOrderStatusChange` para todo pedido con `waPhone`.
- **Coexistencia:** si el dueño contesta a mano desde la app WhatsApp Business, el bot se
  calla en esa charla durante 30 minutos.

Los precios salen de las mismas funciones que usan `createFavorOrder` y `createOrder`
(`computeDeliveryFee`, recargos de lluvia y nocturno, uso de la app).

## Puesta en marcha

1. **Meta for Developers:** crear una app de tipo *Business* y agregarle el producto
   *WhatsApp*.
2. **Número:**
   - **Para probar:** Meta da un número de prueba que solo puede escribir a hasta 5 números
     autorizados.
   - **Para usar el número de siempre:** hay que conectarlo en modo *coexistencia*, con
     el registro integrado (Embedded Signup). El número tiene que estar en **WhatsApp
     Business**, no en WhatsApp común. Desde el celular se escanea un QR y la app sigue
     funcionando como siempre.
3. **Token permanente:** en Business Settings → Usuarios del sistema, crear un usuario,
   darle acceso a la app y generar un token con `whatsapp_business_messaging` y
   `whatsapp_business_management`.
4. **`functions/.env`:** crearlo a partir de `functions/.env.example`. No se sube a git.
5. **Deploy:**
   `FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools deploy --only functions,firestore:rules`
6. **Webhook en Meta (WhatsApp → Configuración):**
   - URL de devolución de llamada:
     `https://us-central1-godelivery-magdalena.cloudfunctions.net/whatsappWebhook`
   - Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN` de `.env`.
   - Suscribir los campos `messages` y `smb_message_echoes` (este último solo con
     coexistencia).
7. **Apagar el bot viejo** (`whatsapp-bot/`, Baileys) para que no contesten dos bots.

Para apagar el bot sin deployar, crear `settings/whatsapp_bot` con `{ enabled: false }`.

## Menú y pasos

- **Bienvenida:** un solo desplegable "Ver opciones" por secciones (Pedir · Mi cuenta · Ayuda). El primer saludo
  del día va con el banner (`public/wa-banner.jpg`). Un comercio ve primero "Cadete para mi local".
  En `cloud-api.js`, 2 o más botones salen como desplegable; las preguntas de sí/no llevan `asButtons: true`.
- **Links como botones** (Seguir en vivo, Ver en el mapa, Ver menú), 👍 al confirmar y "escribiendo…".
- **Compras comercio por comercio** (`mandadoStops`, como la app), con parada extra cobrada igual que la app.
- **Pedido de una:** "una coca de Paulos, dos manzanas del Lucianito y 1 kg de carne de San Javier" o un audio
  → el bot muestra "Entendí esto" con cada comercio y el cliente confirma o corrige (`understand.js`).
- **Resumen con ✏️ Editar** (lista, retiro, entrega, datos, pago) y vuelta al resumen.
- **Direcciones guardadas:** las últimas 3 (`wa_sessions.addresses`).
- **Formulario nativo (WhatsApp Flows):** después de la lista, "Completar pedido" abre una pantalla con dirección
  (guardadas, mandar ubicación u otra), datos, pago y propina (300/500/700 u "Otro monto" libre; suma al total y va al
  cadete). JSON en `flows/pedido.json`, se sube con `node scripts/wa-flow.mjs`. Sin endpoint propio: los datos
  van en el mensaje y la respuesta vuelve como `nfm_reply`. Se puede seguir contestando por el chat.
  Apagarlo sin deployar: `settings/whatsapp_bot { form: false }`. **Publicarlo exige el negocio verificado en
  Meta** (error 139000); hasta entonces `WHATSAPP_FLOW_MODE=draft`. Al pasar al número de GO! hay que crearlo
  de nuevo en esa cuenta (`create <WABA_ID>`, `publish`) y cambiar `WHATSAPP_FLOW_ID`.
- **Sin cadetes:** "🔔 Avisame" → `wa_waitlist`; cuando un cadete se conecta (`onDriverOnlineStatusChanged`)
  le llega "¡Ya hay un cadete!" con Confirmar (el pedido quedó en el resumen).
- **Puntos y sorteos:** saldo de GoPoints y anotarse en los sorteos abiertos (mismas reglas que `joinGiveaway`).
- **Admin → Bot WhatsApp → Charlas:** las últimas conversaciones (`wa_sessions.log`), "Atender yo" (pasa a
  Humano / Soporte) y "Devolver al bot".

## Admin → Bot WhatsApp → Ajustes

- **Gasto y tope:** mensajes enviados (`wa_usage/{AAAA-MM}`) × precio por mensaje, pasados los 1.000 gratis, contra
  `wa_config/bot.budgetArs` ($100.000 por defecto). Al 80% avisa a los admins. Al llegar, nada sale por la API (tampoco
  soporte ni avisos) y los clientes los atiende una persona desde el celular. Es un cálculo propio: la factura la hace Meta.
- **Vincular:** "Vincular con Meta" (registro con QR, coexistencia; pide `WHATSAPP_APP_ID` en `.env` y una configuración
  de Facebook Login para empresas con su id cargado en el panel) o a mano con token e ids. Ver `link.js`. El token va a
  `wa_secrets/cloud_api` (ninguna regla deja leerlo), manda sobre `.env`, y vincular prende el modo prueba.
- **Modificarlo:** encendido, modo prueba, camino corto, imagen del saludo, saludo, mensajes y opciones del menú.
  El servidor lo toma en hasta un minuto (`bot-config.js`).
- **Camino corto** (`short`, prendido por defecto): pide todo en un mensaje (`parseQuick`) y repregunta solo lo que
  falta, sin el paso de datos ni el formulario. Lo que no reconoce queda en el texto que lee el cadete.

## IA (solo si hace falta)

`understand.js`, en este orden:
1. **Reglas** (gratis): "<qué> de/del/en <comercio>", con los comercios conocidos (`comercios` + `mandadoPlaces`).
2. **Claude Haiku 5.5** si las reglas no alcanzan (o para leer una foto de una lista). Necesita
   `ANTHROPIC_API_KEY` en `functions/.env`. Tope de 15 llamadas por cliente por día; uso en `wa_ai_log`.
   `wa_config/ai` (`{ enabled, model, dailyLimit }`) la apaga o cambia sin publicar.
3. **Audios:** Google Speech-to-Text v2 (hay que activar la API en Google Cloud) y vuelven al paso 1.
Un texto suelto en el menú solo se entiende con reglas: una pregunta no gasta IA.

## Cliente de WhatsApp y seguimiento en vivo

- **Usuario propio.** El cliente sin cuenta en la app queda como `users/{número}` (`isWhatsAppClient: true`)
  desde su primer pedido (`wa-users.js`). Es el mismo `userId` de sus pedidos: suma GoPoints al
  completarlos como cualquier cliente. Si el número tiene cuenta en la app, el pedido es de esa cuenta.
- **Link `/en-vivo/{token}`.** Cada pedido del bot lleva un `trackingToken` al azar. El bot lo manda al
  confirmar, al asignarse el cadete y en *Mis pedidos*. La página (`en-vivo.html` + `src/en-vivo.js`) es
  solo la pantalla de seguimiento de la app: sin encabezado, barra ni botón de volver.
- **Sesión del link.** `waTrackingSession` cambia el token por una sesión de Firebase del cliente
  (custom token, uid = su número) que vive en memoria, solo en esa pestaña. Con ella ve el mapa en vivo,
  cancela mientras nadie tomó el pedido y califica al final (ve los puntos ganados). La sesión se da
  mientras el pedido está en curso y hasta 12 h después. Si el número tiene cuenta en la app, el link
  abre `#/pedido/{id}` con su propio login: nunca se entrega una cuenta real por un link.
- **Sin chat de la app.** En los pedidos de WhatsApp el cadete le escribe al cliente por WhatsApp
  (botón verde del panel; `openChat` redirige a WhatsApp si se intenta abrir el chat).
- **Permiso necesario en Google Cloud:** para firmar las sesiones, la cuenta de servicio de las
  funciones necesita el rol *Service Account Token Creator* sobre sí misma. Sin él, el link muestra
  "No pudimos abrir tu pedido" y el log dice `iam.serviceAccounts.signBlob`.

## Modo prueba (lista de números)

Para probar el bot en un número que ya usa gente (por ejemplo el personal del dueño, antes de
pasarlo al de GO!): **Admin → Ajustes → Economía → Modo prueba del bot**.

- Con el modo prendido, el bot contesta **solo** a los números de la lista.
- A los demás no les contesta, no les marca los mensajes como leídos y no guarda nada de esas
  charlas, ni siquiera lo que el dueño les contesta a mano.
- Los números se guardan en `wa_config/test_mode` (`{ enabled, numbers: [{ phone, label }] }`),
  que solo puede leer el admin. No van en `settings`, porque esa colección la lee cualquiera.
- Si no se puede leer la lista, el bot no contesta: mejor perder un mensaje que contestarle a un
  contacto personal.

Para pasar del número de prueba al de GO!: desconectar el número de prueba en Meta, conectar el
de GO! y cambiar `WHATSAPP_PHONE_NUMBER_ID` en `functions/.env`. Después, apagar el modo prueba.

## Pruebas

`tests/whatsapp-bot.test.mjs` prueba conversaciones completas contra el webhook en el
emulador. En el emulador no se envía nada: cada mensaje del bot queda en `wa_outbox`.

```
FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only functions,firestore,auth --project demo-godelivery "node tests/whatsapp-bot.test.mjs"
```

En la vista previa del panel del comercio, `?whatsapp=1` carga una consulta de ejemplo.

## Límites conocidos

- **Ventana de 24 h:** WhatsApp solo deja escribirle al cliente dentro de las 24 h de su
  último mensaje. Los avisos de un pedido caen siempre dentro de esa ventana; fuera de ella
  harían falta plantillas aprobadas por Meta.
- **Seguimiento en vivo:** el bot no manda link. `seguimiento.html` lee `orders` sin iniciar
  sesión, y las reglas ya no lo permiten.
- **Fotos y audios:** se copian a Storage (`wa-media/`). El cadete o el comercio los abren
  desde el link que queda en el detalle del pedido.
