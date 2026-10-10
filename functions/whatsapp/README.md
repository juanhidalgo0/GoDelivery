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

## Pruebas

`tests/whatsapp-bot.test.mjs` prueba conversaciones completas contra el webhook en el
emulador. En el emulador no se envía nada: cada mensaje del bot queda en `wa_outbox`.

```
FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --only functions,firestore --project demo-godelivery "node tests/whatsapp-bot.test.mjs"
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
