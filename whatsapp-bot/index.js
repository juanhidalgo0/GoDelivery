import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
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

// Caches for Firestore push listeners to prevent duplicate notifications
const orderStatusCache = new Map();
let isInitialOrdersLoad = true;
const sentAdminMessageTimestamps = new Set();
let isInitialSupportLoad = true;

// Track automated bot message IDs to allow safe self-testing without infinite loops
const sentBotMessageIds = new Set();
let currentSimulatedResponses = null;

function arePhonesEquivalent(p1, p2) {
  if (!p1 || !p2) return false;
  const c1 = String(p1).replace(/\D/g, '');
  const c2 = String(p2).replace(/\D/g, '');
  if (!c1 || !c2) return false;
  if (c1 === c2) return true;
  // Argentina 549 vs 54 normalization
  const norm1 = c1.startsWith('549') ? '54' + c1.slice(3) : c1;
  const norm2 = c2.startsWith('549') ? '54' + c2.slice(3) : c2;
  if (norm1 === norm2) return true;
  // Suffix matching (last 8-10 digits)
  if (c1.length >= 8 && c2.length >= 8) {
    if (c1.slice(-8) === c2.slice(-8)) return true;
  }
  return false;
}

async function sendBotMessage(jid, content) {
  if (currentSimulatedResponses && content?.text) {
    currentSimulatedResponses.push(content.text);
  }
  if (!sock) return null;
  try {
    const result = await sock.sendMessage(jid, content);
    if (result?.key?.id) {
      sentBotMessageIds.add(result.key.id);
      if (sentBotMessageIds.size > 2000) {
        const first = sentBotMessageIds.values().next().value;
        sentBotMessageIds.delete(first);
      }
    }
    return result;
  } catch (err) {
    console.error(`Error enviando mensaje a ${jid}:`, err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// 1. INICIALIZACIÓN DEL BOT DE BAILEYS
// ══════════════════════════════════════════════════════════

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

        // Start Firestore Real-time Listeners once WhatsApp socket is ready
        setupOrdersStatusListener();
        setupSupportChatListener();
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const msgId = msg.key?.id;
        if (msgId && sentBotMessageIds.has(msgId)) {
          continue; // Ignore bot's own automated messages
        }

        const rawFrom = msg.key.remoteJid;
        if (!rawFrom) continue;
        if (rawFrom.endsWith('@g.us')) continue; // Ignore groups

        const myJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
        const fromJid = jidNormalizedUser(rawFrom);
        const myClean = (botPhoneNumber || myJid || '').replace(/\D/g, '');
        const fromClean = fromJid.replace(/\D/g, '');
        const isSelfChat = arePhonesEquivalent(myClean, fromClean) || (myJid && fromJid === myJid);

        // If fromMe is true and recipient is NOT self-chat, it's an outgoing message to a 3rd party, ignore
        if (msg.key.fromMe && !isSelfChat) {
          continue;
        }

        const phone = fromClean || myClean;
        const pushName = msg.pushName || (isSelfChat ? 'Yo (Test)' : 'Cliente');

        const isAudio = Boolean(msg.message.audioMessage);
        const isImage = Boolean(msg.message.imageMessage);

        // Extract message body text
        let text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          msg.message.templateButtonReplyMessage?.selectedId ||
          msg.message.buttonsResponseMessage?.selectedButtonId ||
          msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
          ''
        ).trim();

        if (!text && isAudio) {
          text = '🎤 [Nota de voz / Audio recibido]';
        } else if (!text && isImage) {
          text = '📷 [Foto / Imagen recibida]';
        }

        if (!text) continue;

        // Prevent bot from responding to its own menu/notification texts if somehow ID wasn't caught
        if (isSelfChat && (text.startsWith('👋 *¡Hola') || text.startsWith('🛵 *¡Solicitud') || text.startsWith('🍔 *Comercios') || text.startsWith('📦 *Estado de Pedidos') || text.startsWith('🧑‍💼 *Atención') || text.startsWith('🚴 *¡Sumate'))) {
          continue;
        }

        console.log(`📩 Mensaje ${isSelfChat ? 'de Auto-Test (Vos mismo)' : 'entrante'} +${phone} (${pushName}): "${text}"`);
        await handleIncomingMessage(fromJid, phone, pushName, text, { isAudio, isImage });
      }
    });

  } catch (err) {
    console.error('❌ Error fatal iniciando WhatsApp Bot:', err);
    connectionStatusText = `Error: ${err.message}`;
    setTimeout(startBot, 5000);
  }
}

// ══════════════════════════════════════════════════════════
// 2. VERIFICACIÓN DE REPARTIDORES & CÁLCULO DE TARIFAS
// ══════════════════════════════════════════════════════════

async function hasOnlineDrivers() {
  try {
    const snap = await db.collection('users').where('isOnline', '==', true).get();
    if (snap.empty) return false;
    return snap.docs.some(doc => {
      const data = doc.data();
      const role = (data.role || '').toLowerCase();
      const isDel = data.isDelivery === true || data.isDelivery === 'true' || ['delivery', 'driver', 'repartidor', 'chofer'].includes(role);
      return isDel;
    });
  } catch (err) {
    console.error('Error verificando repartidores online:', err);
    return false;
  }
}

async function getGlobalSettings() {
  try {
    const snap = await db.collection('settings').doc('global').get();
    return snap.exists ? snap.data() : {};
  } catch (e) {
    console.warn('Error leyendo settings/global:', e.message);
    return {};
  }
}

function isNightSurchargeActive(nightConfig) {
  if (!nightConfig || !nightConfig.enabled) return false;
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTotal = currentHour * 60 + currentMin;

  const [startH, startM] = (nightConfig.start || '00:00').split(':').map(Number);
  const [endH, endM] = (nightConfig.end || '06:00').split(':').map(Number);
  const startTotal = (startH || 0) * 60 + (startM || 0);
  const endTotal = (endH || 0) * 60 + (endM || 0);

  if (startTotal <= endTotal) {
    return currentTotal >= startTotal && currentTotal < endTotal;
  } else {
    // Crosses midnight, e.g. 23:00 to 06:00
    return currentTotal >= startTotal || currentTotal < endTotal;
  }
}

function detectStopsFromText(text) {
  if (!text) return { stopsCount: 1, origin: text };
  const raw = text.trim();
  
  // 1. Check numbered or bulleted items: "1. ... 2. ...", "1- ... 2- ...", "\n• ... \n• ..."
  const numberedItems = raw.split(/(?:^|\n|\s+)(?:[1-9]\s*[\.\-\)]|\•|\-|\*)\s+/).map(s => s.trim()).filter(Boolean);
  if (numberedItems.length >= 2) {
    const count = Math.min(5, numberedItems.length);
    return { stopsCount: count, origin: raw };
  }

  // 2. Check multiline text
  const lines = raw.split(/\r?\n+/).map(s => s.trim()).filter(s => s.length > 2);
  if (lines.length >= 2) {
    const count = Math.min(5, lines.length);
    return { stopsCount: count, origin: raw };
  }

  // 3. Check commas (e.g. "Kiosco Paulos, Farmacia Pasteur, Super Día")
  const commaParts = raw.split(/,\s*/).map(s => s.trim()).filter(s => s.length > 2);
  if (commaParts.length >= 2) {
    const count = Math.min(5, commaParts.length);
    return { stopsCount: count, origin: raw };
  }

  // 4. Check " y " or " e " conjunction (e.g. "Kiosco Paulos y Farmacia Pasteur")
  const conjunctionParts = raw.split(/\s+(?:y|e)\s+/i).map(s => s.trim()).filter(s => s.length > 2);
  if (conjunctionParts.length >= 2) {
    const count = Math.min(5, conjunctionParts.length);
    return { stopsCount: count, origin: raw };
  }

  return { stopsCount: 1, origin: raw };
}

async function calculateGoFavorPricing(stopsCount = 1) {
  const s = await getGlobalSettings();
  
  // Base shipping in Magdalena: deliveryMinPrice / deliveryBasePrice ($2.000)
  const baseShipping = Math.max(s.deliveryMinPrice || 2000, s.deliveryCost || 1800, s.deliveryBasePrice || 1400);
  const gestionFee = s.favorPurchaseFee !== undefined ? s.favorPurchaseFee : 400;
  const extraStopFee = s.deliveryExtraStopFee !== undefined ? s.deliveryExtraStopFee : 1500;
  const extraStopsTotal = Math.max(0, stopsCount - 1) * extraStopFee;

  const subtotal = baseShipping + gestionFee + extraStopsTotal;

  // App Fee (4%)
  const appFeeConfig = s.servicesAppFeeConfig?.gofavor || { type: 'percentage', value: 4 };
  let appFee = 0;
  if (appFeeConfig.type === 'fixed') {
    appFee = appFeeConfig.value || 0;
  } else {
    appFee = Math.ceil((subtotal * ((appFeeConfig.value || 4) / 100)) / 10) * 10;
  }

  // Rain Surcharge
  const isRain = s.rainMode === 'on';
  const rainSurcharge = isRain ? (s.deliveryRainSurcharge || 500) : 0;

  // Night Surcharge
  const isNight = isNightSurchargeActive(s.nightSurchargeConfig);
  let nightSurcharge = 0;
  if (isNight) {
    if (s.nightSurchargeConfig.type === 'fixed') {
      nightSurcharge = s.nightSurchargeConfig.value || 500;
    } else {
      nightSurcharge = Math.ceil((baseShipping * ((s.nightSurchargeConfig.value || 10) / 100)) / 10) * 10;
    }
  }

  const total = subtotal + appFee + rainSurcharge + nightSurcharge;

  return {
    baseShipping,
    gestionFee,
    extraStopFee,
    extraStopsTotal,
    stopsCount,
    appFee,
    rainSurcharge,
    nightSurcharge,
    total
  };
}

// ══════════════════════════════════════════════════════════
// 2.1. REGISTRO Y DETECCIÓN DE COMERCIOS
// ══════════════════════════════════════════════════════════

let registeredComerciosCache = [];
let lastComerciosFetchTime = 0;

async function getRegisteredComercios() {
  const now = Date.now();
  if (registeredComerciosCache.length > 0 && (now - lastComerciosFetchTime < 60000)) {
    return registeredComerciosCache;
  }
  try {
    const snap = await db.collection('comercios').get();
    const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    registeredComerciosCache = list;
    lastComerciosFetchTime = now;
    return list;
  } catch (err) {
    console.error('Error cargando lista de comercios en WhatsApp Bot:', err);
    return registeredComerciosCache;
  }
}

async function findRegisteredComercio(phone) {
  if (!phone) return null;
  const comercios = await getRegisteredComercios();
  const cleanPhone = String(phone).replace(/\D/g, '');
  
  for (const c of comercios) {
    const phonesToCheck = [c.phone, c.whatsapp, c.tel, c.ownerPhone, c.celular].filter(Boolean);
    for (const p of phonesToCheck) {
      if (arePhonesEquivalent(cleanPhone, p)) {
        return c;
      }
    }
  }
  return null;
}

async function createCommerceCadeteriaOrder(from, phone, pushName, comercio, text, meta = {}) {
  try {
    const driversAvailable = await hasOnlineDrivers();
    if (!driversAvailable) {
      await sendBotMessage(from, {
        text: `🛵 *¡Hola ${comercio.name}!* ❌\n\nEn este momento no hay repartidores disponibles conectados en el radar de Magdalena.\nPor favor, aguardá unos minutos o escribí *4* para comunicarte con soporte.`
      });
      return;
    }

    const orderDocRef = db.collection('orders').doc();
    const shortId = Math.floor(100000 + Math.random() * 900000).toString();
    const s = await getGlobalSettings();
    const baseShipping = Math.max(s.deliveryMinPrice || 2000, s.deliveryCost || 1800, s.deliveryBasePrice || 1400);

    const detailNotes = meta.isAudio 
      ? '🎤 [Nota de voz / Audio recibido]' 
      : (meta.isImage ? '📷 [Foto / Imagen comanda recibida]' : (text ? `📝 "${text}"` : ''));

    const newOrder = {
      orderId: shortId,
      source: 'whatsapp_bot',
      isFavor: true,
      isCommerceCadeteria: true,
      orderType: 'cadeteria',
      favorType: 'cadeteria',
      status: 'pending',
      comercioId: comercio.id,
      comercioName: comercio.name,
      comercioAddress: comercio.address || comercio.name,
      userName: comercio.name,
      userPhone: phone,
      userId: phone,
      pickupAddress: comercio.address || comercio.name,
      dropoffAddress: 'Entregas en Magdalena (según tickets en local)',
      deliveryAddress: 'Entregas en Magdalena (según tickets en local)',
      details: `🛵 Cadetería On-Demand para ${comercio.name}.\n${detailNotes}\n\nEl repartidor coordinará la cantidad de paquetes en mostrador.`,
      stopsCount: 1,
      deliveryCost: baseShipping,
      total: baseShipping,
      driverEarnings: baseShipping,
      paymentMethod: 'efectivo',
      noCodeRequired: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await orderDocRef.set(newOrder);

    // Seed local cache
    const cleanPhone = String(phone).replace(/\D/g, '');
    const targetJid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
    orderStatusCache.set(orderDocRef.id, { status: 'pending', targetJid, rawPhone: phone, shortNum: shortId });

    await sendBotMessage(from, {
      text: `🛵 *¡Cadete solicitado con éxito para ${comercio.name}!* ✨\n\n📋 *Solicitud #${shortId}*\n📍 *Retiro en local:* ${comercio.address || comercio.name}\n\n🚨 *¡Ya está sonando en el radar de todos los repartidores activos de Magdalena!*\nEl repartidor se dirigirá al local y registrará la cantidad de paquetes con tus comandas/tickets físicos.\n\n_Te avisaremos por acá cuando el chofer tome el viaje._`
    });

  } catch (err) {
    console.error('Error creando orden de cadeteria en Firestore:', err);
    await sendBotMessage(from, {
      text: `⚠️ Ocurrió un error registrando tu solicitud de cadete. Por favor contactá a soporte.`
    });
  }
}

// ══════════════════════════════════════════════════════════
// 3. ENRUTADOR DE CONVERSACIONES & MÁQUINA DE ESTADOS
// ══════════════════════════════════════════════════════════

async function handleIncomingMessage(from, phone, pushName, text, meta = {}) {
  const normalized = text.toLowerCase().trim();
  const session = userSessions.get(from) || { step: 'idle', data: {} };
  session.lastActive = Date.now();

  // Check if sender is a registered commerce
  const registeredComercio = await findRegisteredComercio(phone);
  if (registeredComercio && session.step === 'idle') {
    // Check if commerce is asking for cadete or sending text/audio/image
    const isCadeteKeyword = ['cadete', 'moto', 'pedido', 'tengo', 'sale', 'envio', 'paquete', 'comanda', 'hola', 'buenas', '1'].some(k => normalized.includes(k));
    if (isCadeteKeyword || meta.isAudio || meta.isImage) {
      await createCommerceCadeteriaOrder(from, phone, pushName, registeredComercio, text, meta);
      return;
    }
  }

  // Global reset commands
  if (['menu', 'inicio', 'hola', 'buenas', 'volver', 'empezar', 'reset'].includes(normalized)) {
    userSessions.set(from, { step: 'idle', data: {} });
    await sendMainMenu(from, pushName);
    return;
  }

  if (normalized === 'cancelar' || normalized === 'anular') {
    userSessions.set(from, { step: 'idle', data: {} });
    await sendBotMessage(from, {
      text: `❌ *Operación cancelada.*\n\nEscribí *menu* cuando quieras volver al menú principal.`
    });
    return;
  }

  // Handle current active step
  switch (session.step) {
    case 'favor_origin': {
      const { stopsCount } = detectStopsFromText(text);
      session.data.origin = text;
      session.data.stopsCount = stopsCount;
      session.step = 'favor_details';
      userSessions.set(from, session);

      const stopsNotice = stopsCount > 1 
        ? `\n_(Detectamos *${stopsCount} comercios/paradas* 📍)_` 
        : '';

      await sendBotMessage(from, {
        text: `📝 *Paso 2 de 4: Detalle de los Productos a Comprar*${stopsNotice}\n\nEscribí qué necesitás que compremos o retiremos en detalle:\n_(Ej: 1 caja de Paracetamol 500mg, 1 paquete de yerba Playadito y 1 Coca Cola 1.5L)_`
      });
      break;
    }

    case 'favor_details': {
      session.data.details = text;
      session.step = 'favor_destination';
      userSessions.set(from, session);

      await sendBotMessage(from, {
        text: `🏠 *Paso 3 de 4: Dirección de Entrega en Magdalena*\n\n¿A qué dirección te lo llevamos?\nPor favor escribí calle, número y entrecalles:\n_(Ej: Chacabuco 451 e/ Brenan y Perón)_`
      });
      break;
    }

    case 'favor_destination': {
      session.data.destination = text;
      session.step = 'favor_payment';
      userSessions.set(from, session);

      await sendBotMessage(from, {
        text: `💳 *Paso 4 de 4: Método de Pago*\n\n¿Cómo preferís abonar el envío y los productos?\n\n*1.* 💵 *Efectivo* (al recibir el pedido)\n*2.* 📱 *Transferencia / Mercado Pago* (al alias del chofer)\n\n_Respondé con *1* o *2* (o escribí Efectivo / Transferencia):_`
      });
      break;
    }

    case 'favor_payment': {
      let method = 'efectivo';
      let methodLabel = '💵 Efectivo (al recibir)';

      if (normalized === '1' || normalized.includes('efectivo') || normalized.includes('cash') || normalized.includes('plata')) {
        method = 'efectivo';
        methodLabel = '💵 Efectivo (al recibir)';
      } else if (normalized === '2' || normalized.includes('transf') || normalized.includes('mercado') || normalized.includes('mp') || normalized.includes('alias')) {
        method = 'transferencia';
        methodLabel = '📱 Transferencia / Mercado Pago';
      } else {
        await sendBotMessage(from, {
          text: `❓ Por favor elegí una opción de pago válida:\n\n*1.* 💵 *Efectivo*\n*2.* 📱 *Transferencia / Mercado Pago*`
        });
        return;
      }

      session.data.paymentMethod = method;
      session.data.paymentMethodLabel = methodLabel;

      const pricing = await calculateGoFavorPricing(session.data.stopsCount || 1);
      session.data.pricing = pricing;
      session.step = 'favor_confirm';
      userSessions.set(from, session);

      const summaryText = 
`📋 *Resumen de tu Mandado — GoDelivery Magdalena* 🛵✨

🏬 *Comercios (${pricing.stopsCount} parada${pricing.stopsCount > 1 ? 's' : ''}):*
${session.data.origin}

📦 *Productos a comprar:*
${session.data.details}

🏠 *Dirección de Entrega:*
${session.data.destination}

💳 *Método de Pago:* ${methodLabel}

💵 *Desglose del Costo de Envío:*
• Envío base: $${pricing.baseShipping.toLocaleString('es-AR')}
• Gestión de compras: $${pricing.gestionFee.toLocaleString('es-AR')}
${pricing.extraStopsTotal > 0 ? `• Paradas extra (${pricing.stopsCount - 1} × $${pricing.extraStopFee.toLocaleString('es-AR')}): $${pricing.extraStopsTotal.toLocaleString('es-AR')}\n` : ''}• Servicio app (4%): $${pricing.appFee.toLocaleString('es-AR')}
${pricing.rainSurcharge > 0 ? `• Recargo por lluvia: $${pricing.rainSurcharge.toLocaleString('es-AR')}\n` : ''}${pricing.nightSurcharge > 0 ? `• Recargo nocturno: $${pricing.nightSurcharge.toLocaleString('es-AR')}\n` : ''}────────────────────────
💰 *Total del Envío: $${pricing.total.toLocaleString('es-AR')}*

_El costo de los productos comprados se abona al repartidor al momento de recibirlos (${method === 'transferencia' ? 'por alias o ' : ''}en efectivo)._

👉 *¿Confirmás el pedido?*
Respondé *SI* para enviar al repartidor o *CANCELAR* para anular.`;

      await sendBotMessage(from, { text: summaryText });
      break;
    }

    case 'favor_confirm': {
      if (['si', 'confirmar', 'dale', 'ok', 'confirmo', 'si por favor', 's'].includes(normalized)) {
        const driversAvailable = await hasOnlineDrivers();
        if (!driversAvailable) {
          session.step = 'idle';
          session.data = {};
          userSessions.set(from, session);
          await sendBotMessage(from, {
            text: `🛵 *¡Ups! En este momento no hay repartidores disponibles en Magdalena.* ❌\n\nNo fue posible confirmar tu mandado porque no hay choferes conectados en este momento.\nPor favor volvé a intentar más tarde cuando haya repartidores de turno.`
          });
          return;
        }

        await createGoFavorOrder(from, phone, pushName, session.data);
        session.step = 'idle';
        session.data = {};
        userSessions.set(from, session);
      } else {
        await sendBotMessage(from, {
          text: `❓ Por favor respondé *SI* para confirmar tu mandado o *CANCELAR* para anularlo.`
        });
      }
      break;
    }

    case 'support_chat': {
      await saveSupportMessage(from, phone, pushName, text);
      await sendBotMessage(from, {
        text: `✅ *Mensaje recibido por el equipo de Soporte.*\nUn operador humano te responderá directamente por este chat en breve.\n\n_Escribí *menu* si deseás volver al menú principal._`
      });
      break;
    }

    default: {
      // Menu options dispatch
      if (normalized === '1' || normalized.includes('mandado') || normalized.includes('gofavor') || normalized.includes('favor')) {
        const driversAvailable = await hasOnlineDrivers();
        if (!driversAvailable) {
          await sendBotMessage(from, {
            text: `🛵 *¡Hola! En este momento no hay repartidores disponibles en Magdalena.* ❌\n\nNo es posible solicitar mandados o envíos en este momento ya que no hay choferes conectados de turno.\nPor favor, intentá nuevamente más tarde.\n\n_Escribí *menu* para ver otras opciones o consultar soporte._`
          });
          return;
        }

        session.step = 'favor_origin';
        session.data = { stopsCount: 1 };
        userSessions.set(from, session);

        await sendBotMessage(from, {
          text: `🛍️ *Solicitud de Mandado / GoFavor* 🛵📦\n\n📍 *Paso 1 de 4: ¿En qué comercio(s) o dirección compramos/retiramos?*\n\nEscribí el o los comercios donde debemos ir.\n_(Ej: "Farmacia Pasteur" o "Kiosco Paulos y Super Día" si son varios locales)_\n\n_(Escribí *cancelar* para volver al menú)_`
        });
      } else if (normalized === '2' || normalized.includes('comercio') || normalized.includes('comida') || normalized.includes('pedir') || normalized.includes('restaurante')) {
        await sendOpenComerciosList(from);
      } else if (normalized === '3' || normalized.includes('estado') || normalized.includes('pedido') || normalized.includes('donde esta')) {
        await checkActiveOrders(from, phone);
      } else if (normalized === '4' || normalized.includes('soporte') || normalized.includes('humano') || normalized.includes('ayuda') || normalized.includes('reclamo')) {
        session.step = 'support_chat';
        userSessions.set(from, session);
        await sendBotMessage(from, {
          text: `🧑‍💼 *Atención al Cliente GoDelivery Magdalena*\n\nPor favor, escribí en un mensaje tu consulta, duda o detalle del pedido para derivarlo a nuestro equipo humano:`
        });
      } else if (normalized === '5' || normalized.includes('repartidor') || normalized.includes('trabajar') || normalized.includes('chofer')) {
        await sendBotMessage(from, {
          text: `🚴 *¡Sumate al equipo de Repartidores de GoDelivery Magdalena!* 🛵💨\n\nGenerá ingresos con tus propios horarios. Registrate completando el formulario oficial acá:\n\n👉 *${APP_URL}/#/register*\n\n_Requisitos: Moto o Bici, DNI y ganas de trabajar._`
        });
      } else {
        await sendMainMenu(from, pushName);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════
// 4. MENÚ PRINCIPAL & CATÁLOGOS DINÁMICOS
// ══════════════════════════════════════════════════════════

async function sendMainMenu(from, pushName) {
  const menuText = 
`👋 *¡Hola ${pushName}! Te damos la bienvenida a GoDelivery Magdalena* 🛵✨

¿En qué podemos ayudarte hoy?

*1.* 🛍️ *Hacer un Mandado / GoFavor* (Compras, trámites, envíos rápidos)
*2.* 🍔 *Pedir en Comercios Abiertos* (Pizzerías, Hamburgueserías, Kioscos)
*3.* 📍 *Consultar Estado de mi Pedido*
*4.* 🧑‍💼 *Hablar con Atención al Cliente / Soporte Humano*
*5.* 🛵 *Quiero ser Repartidor*

_Respondé con el número de tu opción (1, 2, 3, 4 o 5) o escribí tu consulta._`;

  await sendBotMessage(from, { text: menuText });
}

async function sendOpenComerciosList(from) {
  try {
    const snap = await db.collection('comercios')
      .where('approvedByAdmin', '==', true)
      .where('isOpen', '==', true)
      .limit(10)
      .get();

    if (snap.empty) {
      await sendBotMessage(from, {
        text: `🍔 *Comercios de Magdalena* 🍕🍦\n\nEn este momento los locales están cerrados o fuera de horario comercial.\n\nPodés consultar el catálogo completo, menús y horarios de apertura acá:\n👉 *${APP_URL}*\n\n_O pedí lo que necesites a cualquier hora con la opción *1* (Mandados / GoFavor)._`
      });
      return;
    }

    let msg = `🍔 *Comercios Abiertos Ahora en Magdalena* 🍕✨\n\n`;
    snap.docs.forEach((docSnap, i) => {
      const c = docSnap.data();
      const cat = c.category || 'Gastronomía';
      const catLower = cat.toLowerCase();
      const emoji = catLower.includes('pizza') ? '🍕' :
                    catLower.includes('burger') || catLower.includes('hamburg') ? '🍔' :
                    catLower.includes('helad') ? '🍦' :
                    catLower.includes('kiosco') ? '🏪' :
                    catLower.includes('sushi') ? '🍣' :
                    catLower.includes('empanad') ? '🥟' :
                    catLower.includes('cafe') || catLower.includes('panad') ? '☕' : '🍽️';

      msg += `*${i + 1}.* ${emoji} *${c.name}* (${cat})\n`;
    });

    msg += `\n🛒 *Hacé tu pedido online con menú completo y seguimiento en vivo:*\n👉 *${APP_URL}*\n\n_¡Llega volando a tu puerta con los repartidores de GoDelivery!_`;

    await sendBotMessage(from, { text: msg });
  } catch (err) {
    console.error('Error listando comercios:', err);
    await sendBotMessage(from, {
      text: `🍔 *Comercios de Magdalena*\n\nExplorá todos los locales, promociones y menús online:\n👉 *${APP_URL}*`
    });
  }
}

// ══════════════════════════════════════════════════════════
// 5. CREACIÓN Y CONSULTA DE PEDIDOS EN FIRESTORE
// ══════════════════════════════════════════════════════════

async function createGoFavorOrder(from, phone, pushName, data) {
  try {
    const orderDocRef = db.collection('orders').doc();
    const shortId = Math.floor(100000 + Math.random() * 900000).toString();
    const pricing = data.pricing || await calculateGoFavorPricing(data.stopsCount || 1);
    const stopsCount = data.stopsCount || 1;

    const pickupTitle = stopsCount > 1
      ? `Múltiples comercios (${stopsCount} paradas): ${data.origin}`
      : `Comercio: ${data.origin}`;

    const newOrder = {
      orderId: shortId,
      source: 'whatsapp_bot',
      isFavor: true,
      favorType: 'compra',
      status: 'pending',
      userName: pushName,
      userPhone: phone,
      userId: phone,
      pickupAddress: pickupTitle,
      dropoffAddress: data.destination || 'Magdalena',
      deliveryAddress: data.destination || 'Magdalena',
      userAddress: data.destination || 'Magdalena',
      details: `🏪 Locales (${stopsCount} paradas):\n${data.origin}\n\n📦 Pedido:\n${data.details}`,
      stopsCount: stopsCount,
      extraStopsFee: pricing.extraStopsTotal || 0,
      purchaseFee: pricing.gestionFee || 400,
      deliveryCost: pricing.baseShipping || 2000,
      appUsageFee: pricing.appFee || 0,
      rainSurcharge: pricing.rainSurcharge || 0,
      nightSurcharge: pricing.nightSurcharge || 0,
      total: pricing.total || (pricing.baseShipping + pricing.gestionFee),
      paymentMethod: data.paymentMethod || 'efectivo',
      noCodeRequired: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await orderDocRef.set(newOrder);

    // Seed local cache to avoid duplicate alert
    const cleanPhone = String(phone).replace(/\D/g, '');
    const targetJid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
    orderStatusCache.set(orderDocRef.id, { status: 'pending', targetJid, rawPhone: phone, shortNum: shortId });

    const trackingUrl = `${APP_URL}/#/seguimiento/wa/${orderDocRef.id}`;

    await sendBotMessage(from, {
      text: `🎉 *¡Tu Mandado #${shortId} fue solicitado con éxito!* 🛵💨\n\nYa fue publicado en el radar de repartidores activos de Magdalena. En instantes te notificaremos cuando un repartidor lo acepte y se dirija a los locales.\n\n📍 *Seguí el recorrido en tiempo real acá:*\n👉 *${trackingUrl}*\n\n_¡Te avisaremos por acá cuando el chofer tome el pedido!_`
    });

  } catch (err) {
    console.error('Error creando GoFavor en Firestore:', err);
    await sendBotMessage(from, {
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
      await sendBotMessage(from, {
        text: `🔍 *No encontramos pedidos activos* asociados a tu número (+${phone}).\n\nSi querés hacer un pedido nuevo, respondé *1* para un mandado o *2* para ver comercios.`
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

    await sendBotMessage(from, { text: text.trim() });
  } catch (err) {
    console.error('Error consultando pedidos:', err);
    await sendBotMessage(from, { text: `Error consultando tus pedidos. Intentá de nuevo más tarde.` });
  }
}

// ══════════════════════════════════════════════════════════
// 5. SOPORTE HUMANO EN FIRESTORE
// ══════════════════════════════════════════════════════════

async function saveSupportMessage(from, phone, pushName, messageText) {
  try {
    const chatRef = db.collection('support_chats').doc(phone);
    const messageObj = {
      sender: 'user',
      senderName: pushName,
      text: messageText,
      timestamp: Date.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await chatRef.set({
      userId: phone,
      userName: pushName,
      userPhone: phone,
      source: 'whatsapp_bot',
      isWhatsAppBot: true,
      humanRequested: true,
      status: 'pending',
      lastMessage: messageText,
      lastMessageText: messageText,
      unreadByAdmin: true,
      unreadByUser: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      messages: admin.firestore.FieldValue.arrayUnion(messageObj)
    }, { merge: true });

    console.log(`🧑‍💼 Mensaje de soporte registrado en Firestore para +${phone}`);
  } catch (err) {
    console.error('Error guardando mensaje de soporte:', err);
  }
}

// ══════════════════════════════════════════════════════════
// 6. LISTENERS EN TIEMPO REAL (PUSH NOTIFICATIONS & CHAT)
// ══════════════════════════════════════════════════════════

function setupOrdersStatusListener() {
  console.log('📡 [Orders Listener] Iniciando escucha en tiempo real de pedidos...');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  db.collection('orders')
    .where('createdAt', '>=', since)
    .onSnapshot((snapshot) => {
      if (isInitialOrdersLoad) {
        snapshot.docs.forEach(doc => {
          const o = doc.data();
          const rawPhone = o.userPhone || (o.source === 'whatsapp_bot' ? o.userId : null);
          const shortNum = o.orderId || doc.id.slice(0, 6);
          const cleanPhone = rawPhone ? String(rawPhone).replace(/\D/g, '') : null;
          const targetJid = cleanPhone ? (cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`) : null;
          orderStatusCache.set(doc.id, { status: o.status, targetJid, rawPhone, shortNum });
        });
        isInitialOrdersLoad = false;
        console.log(`📦 [Orders Listener] Cache de estados inicializado con ${snapshot.size} pedidos.`);
        return;
      }

      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'removed') {
          const cached = orderStatusCache.get(change.doc.id);
          orderStatusCache.delete(change.doc.id);
          if (cached && cached.targetJid && cached.status !== 'completed' && cached.status !== 'delivered' && cached.status !== 'cancelled') {
            try {
              await sendBotMessage(cached.targetJid, {
                text: `❌ *Pedido #${cached.shortNum || ''} Cancelado / Eliminado*\n\nTu pedido fue cancelado o eliminado del sistema por el equipo de administración.\n\nSi tenés alguna consulta, respondé *4* para comunicarte con soporte.`
              });
              console.log(`📢 [WhatsApp Alert] Notificado REMOVED/DELETED a ${cached.targetJid} (Pedido #${cached.shortNum})`);
            } catch (delErr) {
              console.error('Error enviando notificación de eliminación:', delErr.message);
            }
          }
          return;
        }

        const doc = change.doc;
        const o = doc.data();
        const orderId = doc.id;
        const shortNum = o.orderId || orderId.slice(0, 6);
        const prevCached = orderStatusCache.get(orderId);
        const prevStatus = prevCached ? (typeof prevCached === 'object' ? prevCached.status : prevCached) : undefined;
        const currentStatus = o.status;

        const rawPhone = o.userPhone || (o.source === 'whatsapp_bot' ? o.userId : null);
        const cleanPhone = rawPhone ? String(rawPhone).replace(/\D/g, '') : null;
        const targetJid = cleanPhone ? (cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`) : null;

        orderStatusCache.set(orderId, { status: currentStatus, targetJid, rawPhone, shortNum });

        if (prevStatus === currentStatus) return;
        if (!rawPhone || !targetJid || !sock || !isConnected) return;

        const trackingUrl = `${APP_URL}/#/seguimiento/wa/${orderId}`;
        const driverName = o.driverName || o.riderName || o.deliveryName || 'un repartidor de GoDelivery';

        try {
          if (currentStatus === 'accepted') {
            await sendBotMessage(targetJid, {
              text: `🛵 *¡Tu Pedido #${shortNum} fue Aceptado!*\n\nEl repartidor *${driverName}* ya tomó tu pedido y está en camino a retirarlo.\n\n📍 *Seguimiento en vivo en el mapa:*\n👉 ${trackingUrl}`
            });
            console.log(`📢 [WhatsApp Alert] Notificado ACCEPTED a +${cleanPhone} (Pedido #${shortNum})`);
          } else if (currentStatus === 'in_preparation') {
            await sendBotMessage(targetJid, {
              text: `👨‍🍳 *Pedido #${shortNum} en Preparación*\n\nEl comercio ya está elaborando tus productos.`
            });
          } else if (currentStatus === 'ready') {
            await sendBotMessage(targetJid, {
              text: `📦 *Pedido #${shortNum} Listo*\n\nTu pedido ya está empaquetado para el retiro del repartidor.`
            });
          } else if (currentStatus === 'on_way') {
            await sendBotMessage(targetJid, {
              text: `🚀 *¡Tu Pedido #${shortNum} está en camino!*\n\n*${driverName}* ya retiró tu pedido y se dirige a tu domicilio (*${o.userAddress || o.dropoffAddress || 'Magdalena'}*).\n\n📍 *Seguimiento en tiempo real:*\n👉 ${trackingUrl}`
            });
            console.log(`📢 [WhatsApp Alert] Notificado ON_WAY a +${cleanPhone} (Pedido #${shortNum})`);
          } else if (currentStatus === 'arrived' || currentStatus === 'outside') {
            await sendBotMessage(targetJid, {
              text: `🔔 *¡Llegó el Repartidor!*\n\n*${driverName}* está afuera en tu puerta. Por favor salí a recibir tu pedido #${shortNum}. ¡Muchas gracias!`
            });
            console.log(`📢 [WhatsApp Alert] Notificado ARRIVED a +${cleanPhone} (Pedido #${shortNum})`);
          } else if (currentStatus === 'completed' || currentStatus === 'delivered') {
            await sendBotMessage(targetJid, {
              text: `✅ *¡Pedido #${shortNum} Entregado con Éxito!* 🎉\n\n¡Esperamos que disfrutes tu pedido!\nGracias por elegir *GoDelivery Magdalena* 🛵✨\n\n_Escribí *menu* cuando quieras hacer otro pedido o mandado._`
            });
            console.log(`📢 [WhatsApp Alert] Notificado COMPLETED a +${cleanPhone} (Pedido #${shortNum})`);
          } else if (currentStatus === 'cancelled' || currentStatus === 'cancelled_by_admin' || currentStatus === 'cancelled_by_user') {
            const reason = o.cancelReason || o.cancellationReason || '';
            await sendBotMessage(targetJid, {
              text: `❌ *Pedido #${shortNum} Cancelado*\n\nTu pedido fue cancelado.${reason ? `\nMotivo: _${reason}_` : ''}\n\nSi tenés dudas, respondé *4* para comunicarte con soporte.`
            });
            console.log(`📢 [WhatsApp Alert] Notificado CANCELLED a +${cleanPhone} (Pedido #${shortNum})`);
          }
        } catch (sendErr) {
          console.error(`Error enviando push de pedido a ${targetJid}:`, sendErr.message);
        }
      });
    }, (err) => {
      console.error('Error en listener de orders:', err);
    });
}

function setupSupportChatListener() {
  console.log('📡 [Support Listener] Iniciando escucha de respuestas del Panel Admin...');

  db.collection('support_chats')
    .onSnapshot((snapshot) => {
      if (isInitialSupportLoad) {
        snapshot.docs.forEach(doc => {
          const d = doc.data();
          if (Array.isArray(d.messages)) {
            d.messages.forEach(m => {
              if (m.sender === 'admin' && m.timestamp) {
                sentAdminMessageTimestamps.add(`${doc.id}_${m.timestamp}`);
              }
            });
          }
        });
        isInitialSupportLoad = false;
        console.log(`🧑‍💼 [Support Listener] Cache de soporte inicializado.`);
        return;
      }

      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'removed') return;
        const doc = change.doc;
        const d = doc.data();
        const chatId = doc.id;

        const isWspChat = d.source === 'whatsapp_bot' || d.isWhatsAppBot === true || /^\d{8,15}$/.test(chatId);
        if (!isWspChat) return;

        const rawPhone = d.userPhone || d.userId || chatId;
        const cleanPhone = String(rawPhone).replace(/\D/g, '');
        if (!cleanPhone || cleanPhone.length < 8) return;
        const targetJid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

        if (!Array.isArray(d.messages) || d.messages.length === 0) return;

        for (const msg of d.messages) {
          if (msg.sender === 'admin') {
            const msgKey = `${chatId}_${msg.timestamp || msg.createdAt || msg.text}`;
            if (!sentAdminMessageTimestamps.has(msgKey)) {
              sentAdminMessageTimestamps.add(msgKey);

              if (sock && isConnected) {
                try {
                  console.log(`💬 Enviando respuesta de soporte a +${cleanPhone}: "${msg.text}"`);
                  await sendBotMessage(targetJid, {
                    text: `🧑‍💼 *Atención al Cliente GoDelivery:*\n\n${msg.text}\n\n_Podés responder directamente por acá si tenés más dudas._`
                  });

                  await doc.ref.update({ unreadByUser: false }).catch(() => {});
                } catch (err) {
                  console.error(`Error enviando mensaje de soporte a +${cleanPhone}:`, err.message);
                }
              }
            }
          }
        }
      });
    }, (err) => {
      console.error('Error en listener de support_chats:', err);
    });
}

// ══════════════════════════════════════════════════════════
// 7. ENDPOINTS HTTP (DASHBOARD, QR VIEWER & HEALTHCHECKS)
// ══════════════════════════════════════════════════════════

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

// API: Simulate incoming chat message
app.post('/api/chat-simulate', async (req, res) => {
  const { text = 'Hola', phone = botPhoneNumber || '5492212025603', name = 'Yo (Simulador)' } = req.body;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const fromJid = `${cleanPhone}@s.whatsapp.net`;
  
  const responses = [];
  currentSimulatedResponses = responses;
  try {
    await handleIncomingMessage(fromJid, cleanPhone, name, text);
    currentSimulatedResponses = null;
    res.json({ success: true, text, responses });
  } catch (err) {
    currentSimulatedResponses = null;
    res.status(500).json({ error: err.message });
  }
});

// API: Send direct WhatsApp message to any phone
app.post('/api/send-direct', async (req, res) => {
  const { phone = botPhoneNumber, text = '🛵 ¡Hola! Mensaje de prueba desde GoDelivery Magdalena.' } = req.body;
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) {
    return res.status(400).json({ error: 'Número de teléfono no especificado' });
  }
  if (!sock || !isConnected) {
    return res.status(503).json({ error: 'El bot de WhatsApp no está conectado todavía' });
  }
  try {
    const targetJid = `${cleanPhone}@s.whatsapp.net`;
    const sent = await sendBotMessage(targetJid, { text });
    res.json({ success: Boolean(sent), targetJid, text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Send Message directly via GET (browser friendly)
app.get('/test-send', async (req, res) => {
  const phone = (req.query.phone || botPhoneNumber || '').replace(/\D/g, '');
  const text = req.query.text || '🛵 ¡Hola! Mensaje de prueba automático del Bot de GoDelivery Magdalena.';
  if (!phone) {
    return res.status(400).json({ error: 'Número de teléfono no especificado ni disponible' });
  }
  if (!sock || !isConnected) {
    return res.status(503).json({ error: 'El bot de WhatsApp no está conectado todavía' });
  }
  try {
    const targetJid = `${phone}@s.whatsapp.net`;
    const sent = await sendBotMessage(targetJid, { text });
    res.json({ success: Boolean(sent), targetJid, text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simulate incoming message via GET (browser friendly)
app.get('/simulate-message', async (req, res) => {
  const phone = (req.query.phone || botPhoneNumber || '5492212025603').replace(/\D/g, '');
  const text = req.query.text || 'Hola';
  const name = req.query.name || 'Usuario Test';
  const fromJid = `${phone}@s.whatsapp.net`;
  try {
    await handleIncomingMessage(fromJid, phone, name, text);
    res.json({ success: true, simulated: { from: fromJid, phone, name, text } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/status-json', (req, res) => {
  res.json({
    connected: isConnected,
    phone: botPhoneNumber,
    statusText: connectionStatusText,
    hasQr: Boolean(currentQr)
  });
});

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
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #090d16;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .wrapper {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(360px, 480px);
      gap: 24px;
      max-width: 960px;
      width: 100%;
      align-items: stretch;
    }
    @media (max-width: 860px) {
      .wrapper { grid-template-columns: 1fr; }
    }
    .card {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 24px;
      padding: 28px 24px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
    }
    .logo {
      width: 54px;
      height: 54px;
      border-radius: 16px;
      background: linear-gradient(135deg, #25D366, #128C7E);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 14px;
      font-size: 26px;
      box-shadow: 0 10px 20px rgba(37, 211, 102, 0.25);
    }
    h1 { font-size: 20px; font-weight: 800; text-align: center; margin-bottom: 4px; }
    p.subtitle { font-size: 12px; color: #94a3b8; text-align: center; margin-bottom: 20px; }
    
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 30px;
      font-size: 11px;
      font-weight: 800;
      margin: 0 auto 18px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-connected { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge-waiting { background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }

    .status-panel {
      background: #0b1120;
      border-radius: 16px;
      padding: 16px;
      border: 1px solid #1e293b;
      margin-bottom: 16px;
      text-align: center;
    }
    .phone-number { font-size: 20px; font-weight: 900; color: #4ade80; letter-spacing: 0.02em; margin-top: 2px; }

    .btn {
      width: 100%;
      height: 44px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 13px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-primary { background: #25D366; color: #022c22; font-weight: 800; }
    .btn-primary:hover { background: #22c55e; }
    .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); margin-top: 10px; }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.25); }

    .tool-box {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 14px;
      margin-top: 14px;
      text-align: left;
    }
    .tool-title { font-size: 11px; font-weight: 800; color: #38bdf8; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .tool-input {
      width: 100%;
      background: #131b2e;
      border: 1px solid #334155;
      color: #fff;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      margin-bottom: 8px;
    }

    /* Simulator Chat Window */
    .simulator-card {
      background: #0c1322;
      border: 1px solid #1e293b;
      border-radius: 24px;
      display: flex;
      flex-direction: column;
      height: 620px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .sim-header {
      background: #17233d;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #1e293b;
    }
    .sim-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #25D366;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .sim-info h3 { font-size: 14px; font-weight: 800; }
    .sim-info p { font-size: 11px; color: #4ade80; display: flex; align-items: center; gap: 4px; }
    
    .sim-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #080c14 url('data:image/svg+xml;utf8,<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><g fill="%231e293b" fill-opacity="0.08"><path d="M20 20 L20 0 L0 0 Z"/></g></svg>') repeat;
    }
    .msg-bubble {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg-user {
      align-self: flex-end;
      background: #005c4b;
      color: #e9edef;
      border-bottom-right-radius: 2px;
    }
    .msg-bot {
      align-self: flex-start;
      background: #202c33;
      color: #e9edef;
      border-bottom-left-radius: 2px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
    .msg-time { font-size: 10px; color: #8696a0; text-align: right; margin-top: 4px; }

    .quick-chips {
      padding: 8px 12px;
      background: #0f172a;
      border-top: 1px solid #1e293b;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }
    .chip {
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip:hover { background: #25D366; color: #022c22; border-color: #25D366; }

    .sim-input-box {
      padding: 12px;
      background: #17233d;
      display: flex;
      gap: 8px;
      border-top: 1px solid #1e293b;
    }
    .sim-input {
      flex: 1;
      background: #0c1322;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 13px;
      color: #fff;
      outline: none;
    }
    .sim-send {
      background: #25D366;
      color: #022c22;
      border: none;
      border-radius: 10px;
      padding: 0 16px;
      font-weight: 800;
      cursor: pointer;
    }
    .sim-send:hover { background: #22c55e; }
  </style>
</head>
<body>
  <div class="wrapper">
    <!-- Server Status & Controls -->
    <div class="card">
      <div class="logo">🛵</div>
      <h1>GoDelivery WhatsApp Bot</h1>
      <p class="subtitle">Servidor 24/7 con persistencia en Firebase</p>

      <div class="badge ${isConnected ? 'badge-connected' : 'badge-waiting'}">
        ${isConnected ? '🟢 CONECTADO' : '🟡 ESPERANDO ESCANEO'}
      </div>

      ${isConnected ? `
        <div class="status-panel">
          <div style="font-size:10px; color:#64748b; font-weight:800; text-transform:uppercase;">Número de WhatsApp Activo</div>
          <div class="phone-number">+${botPhoneNumber}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:6px;">Escuchando mensajes y notificando pedidos en tiempo real.</div>
        </div>

        <div class="tool-box">
          <div class="tool-title">⚡ Envío de Mensaje Real a WhatsApp</div>
          <input type="text" id="directPhone" class="tool-input" placeholder="Ej: 5492212025603" value="${botPhoneNumber || ''}">
          <input type="text" id="directText" class="tool-input" placeholder="Mensaje a enviar" value="🛵 ¡Hola! Mensaje de prueba directo de GoDelivery Magdalena.">
          <button onclick="sendDirectMessage()" class="btn btn-primary" style="height:36px; font-size:12px;">📤 Enviar WhatsApp Real</button>
          <div id="directStatus" style="font-size:11px; margin-top:6px; color:#94a3b8;"></div>
        </div>

        <form action="/logout" method="POST" onsubmit="return confirm('¿Estás seguro de que deseás cerrar la sesión de WhatsApp?')">
          <button type="submit" class="btn btn-danger">🚪 Cerrar Sesión de WhatsApp</button>
        </form>
      ` : `
        ${qrDataUrl ? `
          <div style="background:white; padding:14px; border-radius:18px; text-align:center; margin-bottom:14px;">
            <img src="${qrDataUrl}" style="width:100%; max-width:260px; height:auto; display:block; margin:0 auto;" />
          </div>
          <div style="font-size:11px; color:#cbd5e1; text-align:center; margin-bottom:14px;">
            Abrí WhatsApp en tu teléfono > <strong>Dispositivos Vinculados</strong> > <strong>Vincular un dispositivo</strong>
          </div>
        ` : `
          <div style="padding:40px 20px; color:#64748b; text-align:center; font-size:12px;">
            Generando código QR...
          </div>
        `}
        <button onclick="location.reload()" class="btn btn-primary">🔄 Actualizar Estado</button>
      `}

      <div style="font-size:11px; color:#64748b; margin-top:auto; padding-top:14px; line-height:1.6;">
        💡 <strong>Nota:</strong> Cualquier cliente que envíe un WhatsApp al <strong>+${botPhoneNumber || '5492212025603'}</strong> recibirá respuesta automática al instante.
      </div>
    </div>

    <!-- Live Interactive Simulator -->
    <div class="simulator-card">
      <div class="sim-header">
        <div class="sim-avatar">🛵</div>
        <div class="sim-info">
          <h3>GoDelivery Magdalena</h3>
          <p>● Bot Oficial 24/7 en línea</p>
        </div>
      </div>

      <div id="simMessages" class="sim-messages">
        <div class="msg-bubble msg-bot">
          ¡Hola! 👋 Podés probar las respuestas del Bot de GoDelivery acá mismo en vivo o escribiendo desde otro teléfono a WhatsApp.
          <div class="msg-time">Ahora</div>
        </div>
      </div>

      <div class="quick-chips">
        <button class="chip" onclick="simulateChip('Hola')">👋 Hola</button>
        <button class="chip" onclick="simulateChip('1')">🛍️ 1. Mandado</button>
        <button class="chip" onclick="simulateChip('2')">🍔 2. Comercios</button>
        <button class="chip" onclick="simulateChip('3')">📍 3. Estado Pedido</button>
        <button class="chip" onclick="simulateChip('4')">🧑‍💼 4. Soporte</button>
        <button class="chip" onclick="simulateChip('5')">🛵 5. Repartidor</button>
      </div>

      <form class="sim-input-box" onsubmit="handleSimulatorSubmit(event)">
        <input type="text" id="simInput" class="sim-input" placeholder="Escribí un mensaje..." autocomplete="off" />
        <button type="submit" class="sim-send">Enviar</button>
      </form>
    </div>
  </div>

  <script>
    async function simulateChip(text) {
      document.getElementById('simInput').value = text;
      handleSimulatorSubmit(new Event('submit'));
    }

    function formatWhatsAppMarkdown(text) {
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\\*([^*]+)\\*/g, '<strong>$1</strong>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/~([^~]+)~/g, '<del>$1</del>');
    }

    async function handleSimulatorSubmit(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('simInput');
      const text = input.value.trim();
      if (!text) return;

      const container = document.getElementById('simMessages');

      // Append User message
      const userBubble = document.createElement('div');
      userBubble.className = 'msg-bubble msg-user';
      userBubble.innerHTML = formatWhatsAppMarkdown(text) + '<div class="msg-time">' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</div>';
      container.appendChild(userBubble);
      input.value = '';
      container.scrollTop = container.scrollHeight;

      try {
        const res = await fetch('/api/chat-simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();

        if (data.responses && data.responses.length > 0) {
          data.responses.forEach(respText => {
            const botBubble = document.createElement('div');
            botBubble.className = 'msg-bubble msg-bot';
            botBubble.innerHTML = formatWhatsAppMarkdown(respText) + '<div class="msg-time">' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</div>';
            container.appendChild(botBubble);
          });
        } else {
          const botBubble = document.createElement('div');
          botBubble.className = 'msg-bubble msg-bot';
          botBubble.innerHTML = '✅ <em>Mensaje procesado por el bot.</em>';
          container.appendChild(botBubble);
        }
        container.scrollTop = container.scrollHeight;
      } catch (err) {
        const errBubble = document.createElement('div');
        errBubble.className = 'msg-bubble msg-bot';
        errBubble.innerHTML = '❌ <em>Error conectando con el bot: ' + err.message + '</em>';
        container.appendChild(errBubble);
      }
    }

    async function sendDirectMessage() {
      const phone = document.getElementById('directPhone').value.trim();
      const text = document.getElementById('directText').value.trim();
      const statusDiv = document.getElementById('directStatus');
      statusDiv.innerHTML = '⏳ Enviando WhatsApp...';

      try {
        const res = await fetch('/api/send-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, text })
        });
        const data = await res.json();
        if (data.success) {
          statusDiv.innerHTML = '✅ <span style="color:#4ade80">¡Mensaje de WhatsApp enviado con éxito a +' + phone + '!</span>';
        } else {
          statusDiv.innerHTML = '❌ <span style="color:#f87171">Error: ' + (data.error || 'No se pudo enviar') + '</span>';
        }
      } catch (err) {
        statusDiv.innerHTML = '❌ <span style="color:#f87171">Error de red: ' + err.message + '</span>';
      }
    }
  </script>
</body>
</html>
  `;
  res.send(html);
});

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

// Keep-Alive auto-ping every 5 minutes to prevent free tier cold starts
setInterval(() => {
  fetch(`http://localhost:${PORT}/ping`).catch(() => {});
}, 5 * 60 * 1000);

// Start Express Server
app.listen(PORT, () => {
  console.log(`🌐 [Web Server] Panel web y Healthcheck corriendo en http://localhost:${PORT}`);
  startBot();
});


