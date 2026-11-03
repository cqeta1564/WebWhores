/**
 * Testovací sada pro server restaurace (Úlohy 2, 3, 4, 5 a 6)
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { app, orders, processedEvents, webhookEvents, SHARED_SECRET } = require('./server');
const { sendOrder } = require('./send-order');

let server;
let baseUrl;

function createMockCourier(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/order`,
        close: () => new Promise(res => s.close(res))
      });
    });
  });
}

function computeSignature(payload, secret = SHARED_SECRET) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret)
               .update(body, 'utf8')
               .digest('hex');
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  return fetch(url, options);
}

function resetState() {
  for (const k of Object.keys(orders)) {
    delete orders[k];
  }
  processedEvents.clear();
  webhookEvents.length = 0;
}

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Spouštím automatizované testy serveru restaurace');
  console.log('==================================================\n');

  // Spuštění testovací instance na náhodném volném portu (port 0)
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    resetState();
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     ${err.stack || err.message}`);
      failed++;
    }
  }

  try {
    // --- Úloha 2: Zpracování objednávky a čekání/blokování na odpověď kurýra ---
    await test('Úloha 2: sendOrder() čeká na synchronní blokující odpověď kurýra (HTTP 200)', async () => {
      let courierReceived = false;
      const mockCourier = await createMockCourier((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          courierReceived = true;
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'Připraveno k převzetí' }));
          }, 30);
        });
      });

      try {
        const result = await sendOrder('obj_sync_test', 'http://127.0.0.1:3001/update', mockCourier.url);
        assert.ok(courierReceived, 'Kurýr měl obdržet požadavek');
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.body.status, 'Připraveno k převzetí');
      } finally {
        await mockCourier.close();
      }
    });

    await test('Úloha 2 & 3: sendOrder() obslouží asynchronní přijetí objednávky kurýrem (HTTP 202 Accepted)', async () => {
      const mockCourier = await createMockCourier((req, res) => {
        res.writeHead(202);
        res.end();
      });

      try {
        const result = await sendOrder('obj_async_test', 'http://127.0.0.1:3001/update', mockCourier.url);
        assert.strictEqual(result.status, 202);
      } finally {
        await mockCourier.close();
      }
    });

    await test('Úloha 2: POST /api/order proxy předá objednávku kurýrovi a nastaví iniciální stav', async () => {
      let courierPayload = null;
      const mockCourier = await createMockCourier((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          courierPayload = JSON.parse(body);
          res.writeHead(202);
          res.end();
        });
      });

      try {
        const res = await request('/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'obj_proxy_1', courierUrl: mockCourier.url })
        });

        assert.strictEqual(res.status, 202);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.id, 'obj_proxy_1');
        assert.strictEqual(courierPayload.id, 'obj_proxy_1');
        assert.strictEqual(orders['obj_proxy_1'], 'Žádost o objednávku');
      } finally {
        await mockCourier.close();
      }
    });

    await test('Úloha 2: POST /api/order vrátí 503 při nedostupném kurýrovi', async () => {
      const res = await request('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'obj_offline', courierUrl: 'http://127.0.0.1:59999/order' })
      });

      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.ok(data.error.includes('není dostupný'));
    });

    // --- Úloha 4: Servírování statického obsahu a GET /orders ---
    await test('Úloha 4: GET / vrátí HTML stránku index.html', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Restaurace — Dashboard objednávek'), 'HTML neobsahuje očekávaný titulek');
      assert.ok(text.includes('/orders'), 'HTML neobsahuje odkaz na /orders');
    });

    await test('Úloha 4: GET /orders vrátí prázdný objekt na začátku', async () => {
      const res = await request('/orders');
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.deepStrictEqual(data, {});
    });

    // --- Úloha 3 & 5: Příjem webhooku a ověření podpisu ---
    await test('Úloha 3 & 5: Validní webhook aktualizuje stav a vrátí 200 OK', async () => {
      const payload = { id: 'obj_test_1', status: 'Restaurace připravuje' };
      const rawBody = JSON.stringify(payload);
      const sig = computeSignature(rawBody);

      const res = await request('/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': sig
        },
        body: rawBody
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(orders['obj_test_1'], 'Restaurace připravuje');

      // Kontrola GET /orders
      const ordersRes = await request('/orders');
      const data = await ordersRes.json();
      assert.strictEqual(data['obj_test_1'], 'Restaurace připravuje');
    });

    await test('Úloha 3: Postupný přechod stavů (Restaurace připravuje -> Rozváží se -> Doručeno)', async () => {
      const states = ['Restaurace připravuje', 'Rozváží se', 'Doručeno'];
      for (const st of states) {
        const payload = { id: 'obj_flow', status: st };
        const raw = JSON.stringify(payload);
        const sig = computeSignature(raw);
        const res = await request('/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
          body: raw
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(orders['obj_flow'], st);
      }

      const ordersRes = await request('/orders');
      const data = await ordersRes.json();
      assert.strictEqual(data['obj_flow'], 'Doručeno');
    });

    await test('Úloha 3: Více současných objednávek se eviduje nezávisle', async () => {
      const items = [
        { id: 'order_A', status: 'Restaurace připravuje' },
        { id: 'order_B', status: 'Rozváží se' },
        { id: 'order_C', status: 'Doručeno' }
      ];

      for (const item of items) {
        const raw = JSON.stringify(item);
        const sig = computeSignature(raw);
        const res = await request('/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
          body: raw
        });
        assert.strictEqual(res.status, 200);
      }

      const ordersRes = await request('/orders');
      const data = await ordersRes.json();
      assert.strictEqual(data['order_A'], 'Restaurace připravuje');
      assert.strictEqual(data['order_B'], 'Rozváží se');
      assert.strictEqual(data['order_C'], 'Doručeno');
    });

    // --- Úloha 5: Bezpečnost a X-Signature ---
    await test('Úloha 5: Webhook bez X-Signature hlavičky je odmítnut s 401 Unauthorized', async () => {
      const payload = { id: 'obj_fake', status: 'Doručeno' };
      const res = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(orders['obj_fake'], undefined, 'Objednávka nesmí být uložena při chybějícím podpisu');
    });

    await test('Úloha 5: Webhook s neplatným podpisem (špatný tajný klíč) je odmítnut s 401', async () => {
      const payload = { id: 'obj_tampered', status: 'Doručeno' };
      const raw = JSON.stringify(payload);
      const wrongSig = computeSignature(raw, 'podvrzene-tajemstvi-utocnika');

      const res = await request('/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': wrongSig
        },
        body: raw
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(orders['obj_tampered'], undefined);
    });

    await test('Úloha 5: Webhook s podvrženým tělem zprávy je odmítnut s 401', async () => {
      const originalPayload = { id: 'obj_orig', status: 'Restaurace připravuje' };
      const sig = computeSignature(JSON.stringify(originalPayload));

      // Útočník pozměnil status v těle, ale nechal původní podpis
      const tamperedBody = JSON.stringify({ id: 'obj_orig', status: 'Doručeno' });

      const res = await request('/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': sig
        },
        body: tamperedBody
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(orders['obj_orig'], undefined);
    });

    await test('Úloha 5: Timing-safe ochrana proti ne-ASCII a atypickým délkám podpisu', async () => {
      const weirdSigs = [
        'é'.repeat(64), // Multi-byte UTF8 způsobující rozdílnou délku v bytech
        'invalid_short_hash',
        'a'.repeat(63),
        'a'.repeat(65)
      ];

      for (const sig of weirdSigs) {
        const res = await request('/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': sig
          },
          body: JSON.stringify({ id: 'obj_test', status: 'Doručeno' })
        });
        assert.strictEqual(res.status, 401, `Signatura "${sig.substring(0, 10)}..." měla selhat s 401`);
      }
    });

    await test('Úloha 5: Webhook akceptuje validní X-Signature s prefixem sha256= i velkými písmeny', async () => {
      const payload = { id: 'obj_sig_formats', status: 'Restaurace připravuje' };
      const raw = JSON.stringify(payload);
      const hex = computeSignature(raw);

      // 1. Otestování velkých písmen
      const resUpper = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': hex.toUpperCase() },
        body: raw
      });
      assert.strictEqual(resUpper.status, 200);

      // 2. Otestování s prefixem sha256= (běžný standard webhooků)
      const payload2 = { id: 'obj_sig_prefix', status: 'Rozváží se' };
      const raw2 = JSON.stringify(payload2);
      const hex2 = computeSignature(raw2);
      const resPrefix = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': `sha256=${hex2}` },
        body: raw2
      });
      assert.strictEqual(resPrefix.status, 200);
      assert.strictEqual(orders['obj_sig_prefix'], 'Rozváží se');
    });

    // --- Úloha 6: Ošetření duplicitních notifikací (idempotence) ---
    await test('Úloha 6: První událost s novým event_id se standardně zpracuje', async () => {
      const payload = {
        id: 'obj_idem_1',
        event_id: 'evt_1001',
        status: 'Restaurace připravuje'
      };
      const raw = JSON.stringify(payload);
      const sig = computeSignature(raw);

      const res = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
        body: raw
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(orders['obj_idem_1'], 'Restaurace připravuje');
      assert.ok(processedEvents.has('evt_1001'));
    });

    await test('Úloha 6: Duplicitní událost se stejným event_id je ignorována a nezpůsobí re-zpracování', async () => {
      const payload = {
        id: 'obj_idem_dup',
        event_id: 'evt_dup_999',
        status: 'Restaurace připravuje'
      };
      const raw = JSON.stringify(payload);
      const sig = computeSignature(raw);

      // 1. První odeslání události
      const res1 = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
        body: raw
      });
      assert.strictEqual(res1.status, 200);

      // Simulujeme, že mezitím se stav změnil
      orders['obj_idem_dup'] = 'Rozváží se';

      // 2. Simulace retry: Kurýr poslal znovu stejnou událost evt_dup_999
      const res2 = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
        body: raw
      });

      assert.strictEqual(res2.status, 200);
      const json2 = await res2.json();
      assert.strictEqual(json2.status, 'Ignored duplicate');
      assert.strictEqual(json2.event_id, 'evt_dup_999');

      // DŮLEŽITÉ: Stav objednávky nesmí být přepsán zastaralým duplikátem!
      assert.strictEqual(orders['obj_idem_dup'], 'Rozváží se', 'Duplikát nesmí přepsat novější stav');
    });

    // --- Hraniční stavy a validace ---
    await test('Hraniční stav: Chybějící id nebo status vrátí 400 Bad Request', async () => {
      const invalidPayloads = [
        { id: 'obj_only' },
        { status: 'Doručeno' },
        {}
      ];

      for (const p of invalidPayloads) {
        const raw = JSON.stringify(p);
        const sig = computeSignature(raw);
        const res = await request('/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
          body: raw
        });
        assert.strictEqual(res.status, 400, `Payload ${raw} měl vrátit 400`);
      }
    });

    await test('Hraniční stav: Nevalidní JSON syntaxe vrátí 400 bez pádu serveru', async () => {
      const malformed = '{ invalid_json: ';
      const sig = computeSignature(malformed);
      const res = await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
        body: malformed
      });
      assert.strictEqual(res.status, 400);
    });

    await test('Úloha 5 & 6: GET /api/events eviduje auditní záznamy', async () => {
      const payload = { id: 'obj_audit', event_id: 'evt_audit_1', status: 'Doručeno' };
      const raw = JSON.stringify(payload);
      const sig = computeSignature(raw);
      await request('/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
        body: raw
      });

      const res = await request('/api/events');
      assert.strictEqual(res.status, 200);
      const events = await res.json();
      assert.ok(Array.isArray(events));
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].id, 'obj_audit');
      assert.strictEqual(events[0].signatureValid, true);
    });

  } finally {
    server.close();
  }

  console.log('\n==================================================');
  console.log(`Celkem testů: ${passed + failed} | Úspěšných: ${passed} | Neúspěšných: ${failed}`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
