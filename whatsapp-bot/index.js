import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto
} from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import qrcode from 'qrcode';
import pino from 'pino';
import dotenv from 'dotenv';
import { db, admin } from './firebase-admin.js';
import { useFirestoreAuthState } from './firestore-auth.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_NAME = process.env.SESSION_NAME || 'godelivery_main_bot';
const APP_URL = process.env.APP_URL || 'https://godelivery-magdalena.web.app';

let sock = null;
let currentQr = null;
let isConnected = false;
let botPhoneNumber = null;
let connectionStatusText = 'Iniciando servidor...';
let clearSessionHandler = null;

// User conversation state cache: { [phone]: { step: string, data: object, lastActive: number } }
const userSessions = new Map();

async function startBot() {
  try {
    connectionStatusText = 'Cargando credenciales desde Firestore...';
    console.log(`\n🚀 [WhatsApp Bot] Iniciando sesión: ${SESSION_NAME}...`);

    const { state, saveCreds, clearSession } = await useFirestoreAuthState(db, SESSION_NAME);
    clearSessionHandler = clearSession;

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📱 Usando Baileys v${version.join('.')} (Latest: ${isLatest})`);

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: ['GoDelivery Magdalena', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        connectionStatusText = 'Esperando escaneo de código QR';
        console.log('📲 [WhatsApp Bot] Nuevo código QR generado. Escanealo desde la web o consola.');
      }

      if (connection === 'close') {
        isConnected = false;
        currentQr = null;
        botPhoneNumber = null;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ [WhatsApp Bot] Conexión cerrada. Código: ${statusCode}. Reintentando: ${shouldReconnect}`);
        connectionStatusText = shouldReconnect ? 'Reconectando automáticamente...' : 'Sesión cerrada por el usuario';

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('🧹 [WhatsApp Bot] Sesión cerrada permanentemente. Limpiando Firestore...');
          if (clearSessionHandler) await clearSessionHandler();
          setTimeout(startBot, 3000);
        } else {
          // Reconnect with incremental backoff
          const delay = Math.min(10000, 3000);
          setTimeout(startBot, delay);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQr = null;
        const jid = sock.user?.id || '';
        botPhoneNumber = jid.split(':')[0] || jid.split('@')[0];
        connectionStatusText = `🟢 Conectado exitosamente como +${botPhoneNumber}`;
        console.log(`\n✅ [WhatsApp Bot] ¡Conectado con éxito! Número: +${botPhoneNumber}\n`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue; // Ignore bot's own messages
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        if (isGroup) continue; // Only handle private 1-on-1 chats

        const phone = from.replace(/\D/g, '');
        const pushName = msg.pushName || 'Cliente';

        // Extract message body text
        const text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          ''
        ).trim();

        if (!text) continue;

        console.log(`📩 Mensaje de +${phone} (${pushName}): "${text}"`);
        await handleIncomingMessage(from, phone, pushName, text);
      }
    });

  } catch (err) {
    console.error('❌ Error fatal iniciando WhatsApp Bot:', err);
    connectionStatusText = `Error: ${err.message}`;
    setTimeout(startBot, 5000);
  }
}

// Conversation Router & State Machine
async function handleIncomingMessage(from, phone, pushName, text) {
  const normalized = text.toLowerCase().trim();
  const session = userSessions.get(from) || { step: 'idle', data: {} };
  session.lastActive = Date.now();

  // Reset commands
  if (['menu', 'inicio', 'hola', 'buenas', 'volver', 'cancelar', 'empezar'].includes(normalized)) {
    userSessions.set(from, { step: 'idle', data: {} });
    await sendMainMenu(from, pushName);
    return;
  }

  // Handle steps
  switch (session.step) {
    case 'favor_origin': {
      session.data.origin = text;
      session.step = 'favor_destination';
      userSessions.set(from, session);
      await sock.sendMessage(from, {
        text: `📍 *Paso 2 de 3: ¿A dónde lo llevamos?*\n\nPor favor escribí tu dirección de entrega exacta (Calle, número y barrio o entrecalles):`
      });
      break;
    }

    case 'favor_destination': {
      session.data.destination = text;
      session.step = 'favor_details';
      userSessions.set(from, session);
      await sock.sendMessage(from, {
        text: `📝 *Paso 3 de 3: Detalle del Mandado*\n\nEscribí qué necesitás que compremos o retiremos (ej: _"Comprar 1 jarabe en Farmacia Central y 1 paquete de yerba"_):`
      });
      break;
    }

    case 'favor_details': {
      session.data.details = text;
      session.step = 'idle';
      userSessions.set(from, session);
      await createGoFavorOrder(from, phone, pushName, session.data);
      break;
    }

    case 'support_chat': {
      await saveSupportMessage(from, phone, pushName, text);
      await sock.sendMessage(from, {
        text: `✅ *Mensaje enviado al equipo de soporte.*\nUn operador te responderá por este mismo chat en breve.\n\n_Escribí *menu* si querés volver al menú principal._`
      });
      break;
    }

    default: {
      // Menu options by number
      if (normalized === '1' || normalized.includes('mandado') || normalized.includes('gofavor')) {
        session.step = 'favor_origin';
        session.data = {};
        userSessions.set(from, session);
        await sock.sendMessage(from, {
          text: `🛵 *¡Solicitud de Mandado / GoFavor!* 📦\n\n📍 *Paso 1 de 3:* ¿Dónde tenemos que retirar o comprar el mandado?\n_(Ej: Farmacia Magdalena, Supermercado, o una dirección particular)_`
        });
      } else if (normalized === '2' || normalized.includes('comercio') || normalized.includes('comida') || normalized.includes('pedir')) {
        await sock.sendMessage(from, {
          text: `🍔 *¡Pedí en tus comercios favoritos de Magdalena!* 🍕🍦\n\nPodés explorar todos los locales abiertos, menús y promociones desde nuestra aplicación web oficial:\n\n👉 *${APP_URL}*\n\n_¡Hacé tu pedido online en 1 minuto y llega a tu puerta con seguimiento en vivo!_`
        });
      } else if (normalized === '3' || normalized.includes('estado') || normalized.includes('pedido')) {
        await checkActiveOrders(from, phone);
      } else if (normalized === '4' || normalized.includes('soporte') || normalized.includes('humano') || normalized.includes('ayuda')) {
        session.step = 'support_chat';
        userSessions.set(from, session);
        await sock.sendMessage(from, {
          text: `🧑‍💼 *Atención al Cliente GoDelivery*\n\nPor favor, escribí en un mensaje detallado tu consulta, reclamo o duda para derivarlo a nuestro equipo humano:`
        });
      } else if (normalized === '5' || normalized.includes('repartidor') || normalized.includes('trabajar')) {
        await sock.sendMessage(from, {
          text: `🚴 *¡Sumate al equipo de Repartidores de GoDelivery Magdalena!* 🛵💨\n\nGenerá ingresos con tus propios horarios. Registrate completando el formulario oficial acá:\n\n👉 *${APP_URL}/#/register*\n\n_Requisitos: Moto o Bici, DNI y ganas de trabajar._`
        });
      } else {
        await sendMainMenu(from, pushName);
      }
    }
  }
}

async function sendMainMenu(from, pushName) {
  const menuText = 
`👋 *¡Hola ${pushName}! Te damos la bienvenida a GoDelivery Magdalena* 🛵✨

¿En qué podemos ayudarte hoy?

*1.* 🛍️ *Hacer un Mandado / GoFavor* (Compras, trámites, envíos rápidos)
*2.* 🍔 *Pedir en Comercios Adheridos* (Comida, Kiosco, Helados)
*3.* 📍 *Consultar Estado de mi Pedido*
*4.* 👤 *Hablar con Atención al Cliente / Soporte Humano*
*5.* 🛵 *Quiero ser Repartidor*

_Respondé con el número de tu opción (1, 2, 3, 4 o 5) o escribí tu consulta._`;

  await sock.sendMessage(from, { text: menuText });
}

async function createGoFavorOrder(from, phone, pushName, data) {
  try {
    const orderDocRef = db.collection('orders').doc();
    const shortId = Math.floor(100000 + Math.random() * 900000).toString();

    const newOrder = {
      orderId: shortId,
      source: 'whatsapp_bot',
      isFavor: true,
      favorType: 'mandado',
      status: 'pending',
      userName: pushName,
      userPhone: phone,
      pickupAddress: data.origin || 'A convenir',
      dropoffAddress: data.destination || 'Magdalena',
      userAddress: data.destination || 'Magdalena',
      details: data.details || 'Mandado solicitado por WhatsApp',
      total: 0,
      deliveryCost: 0,
      paymentMethod: 'efectivo',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await orderDocRef.set(newOrder);

    const trackingUrl = `${APP_URL}/#/seguimiento/wa/${orderDocRef.id}`;

    await sock.sendMessage(from, {
      text: `🎉 *¡Tu GoFavor #${shortId} fue registrado con éxito!* 🛵📦\n\n📍 *Origen:* ${data.origin}\n🏠 *Destino:* ${data.destination}\n📝 *Detalle:* ${data.details}\n\nYa lo publicamos en el panel de repartidores de Magdalena. Podés seguir el recorrido en tiempo real acá:\n👉 *${trackingUrl}*\n\n_¡Un repartidor lo aceptará en breve!_`
    });

  } catch (err) {
    console.error('Error creando GoFavor en Firestore:', err);
    await sock.sendMessage(from, {
      text: `⚠️ Ocurrió un error registrando tu pedido. Por favor escribí *4* para comunicarte con soporte.`
    });
  }
}

async function checkActiveOrders(from, phone) {
  try {
    const snap = await db.collection('orders')
      .where('userPhone', '==', phone)
      .where('status', 'in', ['pending', 'accepted', 'in_preparation', 'ready', 'on_way'])
      .get();

    if (snap.empty) {
      await sock.sendMessage(from, {
        text: `🔍 *No encontramos pedidos activos* asociados a tu número (+${phone}).\n\nSi querés hacer un pedido nuevo, respondé *1* para un mandado o *2* para comercios.`
      });
      return;
    }

    let text = `📦 *Tus Pedidos Activos en GoDelivery:*\n\n`;
    snap.docs.forEach((docSnap) => {
      const o = docSnap.data();
      const statusLabels = {
        pending: '⏳ Esperando repartidor',
        accepted: '🛵 Repartidor asignado',
        in_preparation: '👨‍🍳 En preparación',
        ready: '📦 Listo para retiro',
        on_way: '🚀 En camino a tu dirección'
      };
      const status = statusLabels[o.status] || o.status;
      text += `• *Pedido #${o.orderId || docSnap.id.slice(0, 6)}*\n`;
      text += `  Estado: *${status}*\n`;
      text += `  Seguimiento: ${APP_URL}/#/seguimiento/wa/${docSnap.id}\n\n`;
    });

    await sock.sendMessage(from, { text: text.trim() });
  } catch (err) {
    console.error('Error consultando pedidos:', err);
    await sock.sendMessage(from, { text: `Error consultando tus pedidos. Intentá de nuevo más tarde.` });
  }
}

async function saveSupportMessage(from, phone, pushName, messageText) {
  try {
    const chatRef = db.collection('support_chats').doc(phone);
    await chatRef.set({
      userId: phone,
      userName: pushName,
      userPhone: phone,
      source: 'whatsapp_bot',
      isWhatsAppBot: true,
      humanRequested: true,
      status: 'pending',
      lastMessage: messageText,
      unreadByAdmin: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await chatRef.collection('messages').add({
      sender: 'user',
      senderName: pushName,
      text: messageText,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Error guardando mensaje de soporte:', err);
  }
}

// ══════════════════════════════════════════════════════════
// HTTP ENDPOINTS (DASHBOARD, QR VIEWER & HEALTHCHECKS)
// ══════════════════════════════════════════════════════════

// Healthcheck endpoint (for Koyeb, Render & UptimeRobot pings)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: isConnected,
    phoneNumber: botPhoneNumber,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => res.send('pong'));

// Raw QR Image endpoint
app.get('/qr-image', async (req, res) => {
  if (!currentQr) {
    return res.status(404).send('No QR available. Bot is either connected or not ready.');
  }
  try {
    const qrBuffer = await qrcode.toBuffer(currentQr);
    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

// JSON Status endpoint
app.get('/status-json', (req, res) => {
  res.json({
    connected: isConnected,
    phone: botPhoneNumber,
    statusText: connectionStatusText,
    hasQr: !!currentQr
  });
});

// Web QR Scanner and Bot Control Dashboard
app.get('/', async (req, res) => {
  let qrDataUrl = '';
  if (currentQr) {
    qrDataUrl = await qrcode.toDataURL(currentQr, { width: 320, margin: 2 });
  }

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GoDelivery — Panel WhatsApp Bot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 28px;
      max-width: 440px;
      width: 100%;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .logo {
      width: 60px;
      height: 60px;
      border-radius: 18px;
      background: linear-gradient(135deg, #25D366, #128C7E);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 30px;
      box-shadow: 0 10px 25px rgba(37, 211, 102, 0.3);
    }
    h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.02em; margin-bottom: 6px; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 30px;
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-connected { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge-waiting { background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }
    .qr-box {
      background: white;
      padding: 16px;
      border-radius: 20px;
      display: inline-block;
      margin-bottom: 20px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    .qr-box img { width: 100%; max-width: 280px; height: auto; display: block; }
    .btn {
      width: 100%;
      height: 48px;
      border-radius: 14px;
      font-weight: 800;
      font-size: 13px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .btn-primary { background: #25D366; color: #022c22; margin-bottom: 10px; }
    .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .info-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 14px;
      font-size: 12px;
      color: #94a3b8;
      text-align: left;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🛵</div>
    <h1>GoDelivery WhatsApp Bot</h1>
    <p>Servidor 24/7 con persistencia en Firebase Firestore</p>

    <div class="badge ${isConnected ? 'badge-connected' : 'badge-waiting'}">
      ${isConnected ? '🟢 CONECTADO' : '🟡 ESPERANDO ESCANEO'}
    </div>

    ${isConnected ? `
      <div style="background:#0f172a; border-radius:18px; padding:20px; border:1px solid #334155; margin-bottom:20px;">
        <div style="font-size:11px; color:#64748b; font-weight:800; text-transform:uppercase;">Número Activo</div>
        <div style="font-size:22px; font-weight:900; color:#4ade80; margin-top:4px;">+${botPhoneNumber}</div>
        <div style="font-size:12px; color:#94a3b8; margin-top:8px;">El bot está respondiendo mensajes de Magdalena en tiempo real.</div>
      </div>
      <form action="/logout" method="POST" onsubmit="return confirm('¿Estás seguro de que deseás cerrar la sesión de WhatsApp?')">
        <button type="submit" class="btn btn-danger">🚪 Cerrar Sesión de WhatsApp</button>
      </form>
    ` : `
      ${qrDataUrl ? `
        <div class="qr-box">
          <img src="${qrDataUrl}" alt="Escaneá este código QR con WhatsApp" />
        </div>
        <div style="font-size:12px; color:#cbd5e1; margin-bottom:16px;">
          Abrí WhatsApp en tu teléfono > <strong>Dispositivos Vinculados</strong> > <strong>Vincular un dispositivo</strong>
        </div>
      ` : `
        <div style="padding:40px 20px; color:#64748b; font-size:13px;">
          Generando nuevo código QR...
        </div>
      `}
      <button onclick="location.reload()" class="btn btn-primary">🔄 Actualizar Estado</button>
    `}

    <div class="info-box">
      <strong>⚡ Estado del Servidor:</strong><br>
      • Uptime: ${Math.floor(process.uptime())} segundos<br>
      • Persistencia: Firebase Firestore Activa<br>
      • Endpoint Healthcheck: <code>/health</code>
    </div>
  </div>

  <script>
    // Auto-reload page every 5 seconds if waiting for QR scan
    ${!isConnected ? 'setTimeout(() => location.reload(), 5000);' : ''}
  </script>
</body>
</html>
  `;
  res.send(html);
});

// Logout endpoint
app.post('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
    if (clearSessionHandler) {
      await clearSessionHandler();
    }
    isConnected = false;
    currentQr = null;
    botPhoneNumber = null;
    res.redirect('/');
  } catch (err) {
    console.error('Error cerrando sesión:', err);
    res.status(500).send('Error cerrando sesión');
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🌐 [Web Server] Panel web y Healthcheck corriendo en http://localhost:${PORT}`);
  startBot();
});
