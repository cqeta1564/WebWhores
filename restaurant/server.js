const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';
const SHARED_SECRET = process.env.SHARED_SECRET || 'super-tajne-heslo-123';

// Uchováváme rawBody a rawBodyBuffer pro přesný výpočet kryptografického HMAC hashe (Úloha 5)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBodyBuffer = buf;
    req.rawBody = buf.toString('utf8');
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Zakázaná ID pro ochranu proti prototype pollution
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

// Úloha 3 & 4: Úložiště stavů objednávek na serveru restaurace (id -> stav)
const orders = {};

// Úloha 6: Omezená množina evidovaných event_id pro detekci duplicit s FIFO evikcí proti přetečení paměti
const MAX_PROCESSED_EVENTS = 10000;
const processedEvents = new Set();

function addProcessedEvent(eventId) {
  if (processedEvents.size >= MAX_PROCESSED_EVENTS) {
    const oldest = processedEvents.values().next().value;
    processedEvents.delete(oldest);
  }
  processedEvents.add(eventId);
}

// Auditní záznam přijatých webhooků pro zobrazení na frontendu (Úloha 5 & 6)
const webhookEvents = [];

function logWebhookEvent(entry) {
  webhookEvents.unshift({
    timestamp: new Date().toLocaleTimeString('cs-CZ'),
    ...entry
  });
  if (webhookEvents.length > 50) {
    webhookEvents.pop();
  }
}

/**
 * POST /api/order
 * Proxy endpoint pro odeslání objednávky z frontendu na kurýra (řeší CORS)
 * Podporuje jak asynchronní odpověď 202 (Úloha 3+), tak synchronní 200 (Úloha 2)
 */
app.post('/api/order', async (req, res) => {
  const body = req.body || {};
  let orderId = typeof body.id === 'string' ? body.id.trim() : body.id;
  if (!orderId) {
    orderId = `obj_${Math.floor(Math.random() * 900 + 100)}`;
  }
  if (typeof orderId !== 'string' || FORBIDDEN_IDS.has(orderId) || orderId.length > 255) {
    return res.status(400).json({ error: 'Neplatné ID objednávky' });
  }
  const callbackUrl = body.callbackUrl || `http://localhost:${PORT}/update`;
  const courierUrl = body.courierUrl || COURIER_URL;

  try {
    console.log(`[Restaurace] 📤 Odesílám objednávku kurýrovi na ${courierUrl}:`, { id: orderId, callbackUrl });
    const courierRes = await fetch(courierUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, callbackUrl })
    });

    if (courierRes.status === 202) {
      orders[orderId] = 'Žádost o objednávku';
    } else if (courierRes.ok) {
      // Pro případ synchronního kurýrního serveru z Úlohy 2
      try {
        const data = await courierRes.json();
        if (data && data.status) {
          orders[orderId] = data.status;
        } else {
          orders[orderId] = 'Objednávka dokončena';
        }
      } catch (_) {
        orders[orderId] = 'Objednávka dokončena';
      }
    }

    console.log(`[Restaurace] 📬 Odpověď kurýra: HTTP ${courierRes.status} (${courierRes.statusText})`);

    return res.status(courierRes.status).json({
      success: courierRes.ok || courierRes.status === 202,
      courierStatus: courierRes.status,
      id: orderId
    });
  } catch (err) {
    console.error(`[Restaurace] ❌ Chyba při spojení s kurýrem:`, err.message);
    return res.status(503).json({
      error: `Kurýrní server (${courierUrl}) není dostupný. Zkontrolujte, zda běží.`
    });
  }
});

/**
 * POST /update
 * Webhook endpoint s ověřováním HMAC-SHA256 podpisu (Úloha 5) a ošetřením duplicit (Úloha 6)
 */
app.post('/update', (req, res) => {
  const sigHeader = (req.get('X-Signature') || '').trim();
  const cleanSig = sigHeader.toLowerCase().replace(/^sha256=/, '');

  // 1. Ověření HMAC-SHA256 podpisu (Úloha 5)
  // Používáme přesný Buffer raw payloadu, pokud je dostupný, jinak rawBody řetězec
  const hmac = crypto.createHmac('sha256', SHARED_SECRET);
  if (req.rawBodyBuffer) {
    hmac.update(req.rawBodyBuffer);
  } else {
    const rawBody = req.rawBody !== undefined ? req.rawBody : JSON.stringify(req.body || {});
    hmac.update(rawBody, 'utf8');
  }
  const expectedSig = hmac.digest('hex');

  // Bezpečné porovnání v konstantním čase s ochranou proti rozdílným délkám bufferů
  const sigBuffer = Buffer.from(cleanSig, 'utf8');
  const expectedBuffer = Buffer.from(expectedSig, 'utf8');

  const isValid = sigBuffer.length === expectedBuffer.length &&
                  crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!isValid) {
    console.warn(`[Restaurace] ⚠️ 401 Unauthorized: Neplatný nebo chybějící podpis webhooku!`);
    logWebhookEvent({
      id: (req.body && typeof req.body.id === 'string' && req.body.id) || 'neznámé',
      event_id: (req.body && typeof req.body.event_id === 'string' && req.body.event_id) || 'n/a',
      status: (req.body && typeof req.body.status === 'string' && req.body.status) || 'n/a',
      isDuplicate: false,
      signatureValid: false,
      note: 'Odmítnuto (401 Unauthorized - neplatný X-Signature)'
    });
    return res.status(401).json({ error: 'Neplatný nebo chybějící podpis X-Signature' });
  }

  const { id, event_id, status } = req.body || {};

  // Validace povinných polí a ochrana proti prototype pollution
  if (!id || !status || typeof id !== 'string' || typeof status !== 'string') {
    return res.status(400).json({ error: 'Chybí nebo je neplatné pole id nebo status' });
  }

  const cleanId = id.trim();
  const cleanStatus = status.trim();

  if (!cleanId || !cleanStatus || FORBIDDEN_IDS.has(cleanId) || cleanId.length > 255 || cleanStatus.length > 255) {
    return res.status(400).json({ error: 'Neplatná hodnota id nebo status' });
  }

  // 2. Úloha 6: Kontrola duplicitního zpracování podle event_id (idempotence)
  if (event_id !== undefined && event_id !== null) {
    if (typeof event_id !== 'string' || !event_id.trim() || event_id.length > 255) {
      return res.status(400).json({ error: 'event_id musí být neprázdný řetězec do 255 znaků' });
    }
    const cleanEventId = event_id.trim();
    if (processedEvents.has(cleanEventId)) {
      console.log(`[Restaurace] ⚠️ DUPLIKÁT IGNOROVÁN: event_id "${cleanEventId}" již bylo evidováno.`);
      logWebhookEvent({
        id: cleanId,
        event_id: cleanEventId,
        status: cleanStatus,
        isDuplicate: true,
        signatureValid: true,
        note: 'Duplikát ignorován (idempotentní chování)'
      });
      // Vracíme 200 OK, aby kurýr věděl, že zpráva byla doručena, ale stav nepřepisujeme
      return res.status(200).json({ status: 'Ignored duplicate', event_id: cleanEventId });
    }
    // Přidání do seznamu zpracovaných událostí s FIFO limitem
    addProcessedEvent(cleanEventId);
  }

  // 3. Zpracování nové události (Úloha 3)
  orders[cleanId] = cleanStatus;
  logWebhookEvent({
    id: cleanId,
    event_id: (typeof event_id === 'string' && event_id.trim()) || 'n/a',
    status: cleanStatus,
    isDuplicate: false,
    signatureValid: true,
    note: 'Úspěšně zpracováno a aktualizováno'
  });
  console.log(`[Restaurace] 📥 Nová událost [${event_id || 'bez-id'}] | Objednávka ${cleanId} -> "${cleanStatus}"`);

  res.sendStatus(200);
});

/**
 * GET /orders
 * Seznam objednávek pro frontend restaurace (Úloha 4)
 * Vrací přesně slovník { [id]: status } dle zadání
 */
app.get('/orders', (req, res) => {
  res.json(orders);
});

/**
 * GET /api/events
 * Seznam přijatých webhook událostí pro živý audit log na dashboardu
 */
app.get('/api/events', (req, res) => {
  res.json(webhookEvents);
});

// Middleware pro zachycení chyb (např. nevalidní JSON v požadavku)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err) {
    return res.status(400).json({ error: 'Neplatný formát JSON' });
  }
  console.error('[Restaurace] Neošetřená chyba:', err);
  res.status(500).json({ error: 'Interní chyba serveru restaurace' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` Server Restaurace spuštěn na http://localhost:${PORT}`);
    console.log(` Dashboard restaurace:  http://localhost:${PORT}`);
    console.log(` Webhook URL pro kurýra: http://localhost:${PORT}/update`);
    console.log(` Ověřování podpisu a deduplikace event_id aktivní`);
    console.log(`===================================================`);
  });
}

module.exports = {
  app,
  orders,
  processedEvents,
  webhookEvents,
  SHARED_SECRET,
  PORT,
  MAX_PROCESSED_EVENTS,
  addProcessedEvent
};
