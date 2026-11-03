const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';
const SHARED_SECRET = process.env.SHARED_SECRET || 'super-tajne-heslo-123';

// Uchováváme rawBody pro přesný výpočet kryptografického HMAC hashe (Úloha 5)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Úloha 3 & 4: Úložiště stavů objednávek na serveru restaurace (id -> stav)
const orders = {};

// Úloha 6: Množina evidovaných event_id pro detekci a eliminaci duplicit (idempotence)
const processedEvents = new Set();

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
  const orderId = body.id || `obj_${Math.floor(Math.random() * 900 + 100)}`;
  const callbackUrl = body.callbackUrl || `http://localhost:${PORT}/update`;

  try {
    console.log(`[Restaurace] 📤 Odesílám objednávku kurýrovi na ${COURIER_URL}:`, { id: orderId, callbackUrl });
    const courierRes = await fetch(COURIER_URL, {
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
        }
      } catch (_) {}
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
      error: `Kurýrní server (${COURIER_URL}) není dostupný. Zkontrolujte, zda běží.`
    });
  }
});

/**
 * POST /update
 * Webhook endpoint s ověřováním HMAC-SHA256 podpisu (Úloha 5) a ošetřením duplicit (Úloha 6)
 */
app.post('/update', (req, res) => {
  const sigHeader = (req.get('X-Signature') || '').trim();

  // 1. Ověření HMAC-SHA256 podpisu (Úloha 5)
  const rawBody = req.rawBody !== undefined ? req.rawBody : JSON.stringify(req.body || {});
  const expectedSig = crypto.createHmac('sha256', SHARED_SECRET)
                            .update(rawBody, 'utf8')
                            .digest('hex');

  // Bezpečné porovnání v konstantním čase s ochranou proti rozdílným délkám bufferů
  const sigBuffer = Buffer.from(sigHeader, 'utf8');
  const expectedBuffer = Buffer.from(expectedSig, 'utf8');

  const isValid = sigBuffer.length === expectedBuffer.length &&
                  crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!isValid) {
    console.warn(`[Restaurace] ⚠️ 401 Unauthorized: Neplatný nebo chybějící podpis webhooku!`);
    logWebhookEvent({
      id: (req.body && req.body.id) || 'neznámé',
      event_id: (req.body && req.body.event_id) || 'n/a',
      status: (req.body && req.body.status) || 'n/a',
      isDuplicate: false,
      signatureValid: false,
      note: 'Odmítnuto (401 Unauthorized - neplatný X-Signature)'
    });
    return res.status(401).json({ error: 'Neplatný nebo chybějící podpis X-Signature' });
  }

  const { id, event_id, status } = req.body || {};

  if (!id || !status) {
    return res.status(400).json({ error: 'Chybí povinná pole id nebo status' });
  }

  // 2. Úloha 6: Kontrola duplicitního zpracování podle event_id (idempotence)
  if (event_id) {
    if (processedEvents.has(event_id)) {
      console.log(`[Restaurace] ⚠️ DUPLIKÁT IGNOROVÁN: event_id "${event_id}" již bylo evidováno.`);
      logWebhookEvent({
        id,
        event_id,
        status,
        isDuplicate: true,
        signatureValid: true,
        note: 'Duplikát ignorován (idempotentní chování)'
      });
      // Vracíme 200 OK, aby kurýr věděl, že zpráva byla doručena, ale akci znovu neprovádíme
      return res.status(200).json({ status: 'Ignored duplicate', event_id });
    }
    // Přidání do seznamu zpracovaných událostí
    processedEvents.add(event_id);
  }

  // 3. Zpracování nové události (Úloha 3)
  orders[id] = status;
  logWebhookEvent({
    id,
    event_id: event_id || 'n/a',
    status,
    isDuplicate: false,
    signatureValid: true,
    note: 'Úspěšně zpracováno a aktualizováno'
  });
  console.log(`[Restaurace] 📥 Nová událost [${event_id || 'bez-id'}] | Objednávka ${id} -> "${status}"`);

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
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
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
  PORT
};
