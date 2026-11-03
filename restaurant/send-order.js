/**
 * Odeslání objednávky z restaurace na kurýrní server.
 * Kompatibilní se všemi úlohami (Úloha 2, 3, 4, 5, 6).
 */

const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';
const RESTAURANT_PORT = process.env.PORT || 3001;

async function sendOrder(customId, customCallbackUrl, customCourierUrl, options = {}) {
  const args = process.argv.slice(2);
  const waitArg = args.includes('--wait') || args.includes('-w');
  const positionalArgs = args.filter(a => !a.startsWith('-'));

  const orderId = customId || positionalArgs[0] || `obj_${Math.floor(Math.random() * 900 + 100)}`;
  const callbackUrl = customCallbackUrl || positionalArgs[1] || `http://localhost:${RESTAURANT_PORT}/update`;
  const courierUrl = customCourierUrl || COURIER_URL;
  const waitForDelivery = options.waitForDelivery !== undefined ? options.waitForDelivery : waitArg;
  const timeoutMs = options.timeoutMs || 30000;
  const pollIntervalMs = options.pollIntervalMs || 400;

  const orderPayload = {
    id: orderId,
    callbackUrl
  };

  console.log(`[Restaurace] 📤 Odesílám objednávku:`, orderPayload);

  try {
    const res = await fetch(courierUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    console.log(`[Restaurace] 📬 Courier response: HTTP ${res.status} (${res.statusText})`);

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
    }

    if (res.status === 202) {
      console.log('✅ Objednávka byla kurýrem úspěšně přijata ke zpracování (HTTP 202 Accepted).');
      console.log(`Sledujte dashboard restaurace na http://localhost:${RESTAURANT_PORT} pro živé webhook notifikace!`);
    } else if (res.ok) {
      console.log('✅ Objednávka úspěšně dokončena (HTTP 200 OK):', body);
    } else {
      console.log('⚠️ Odpověď kurýra:', body);
    }

    // Úloha 2: Blokující/čekající chování na doručení, pokud je vyžádáno čekání
    let finalStatus = res.ok && res.status === 200 ? (body && body.status) || 'Dokončeno' : null;

    if (waitForDelivery && res.status === 202) {
      console.log(`[Restaurace] ⏳ Čekám na dokončení doručení objednávky ${orderId}...`);
      const startTime = Date.now();
      let lastKnownStatus = 'Žádost o objednávku';

      let restaurantOrdersUrl;
      try {
        const u = new URL(callbackUrl);
        u.pathname = '/orders';
        restaurantOrdersUrl = u.toString();
      } catch (_) {
        restaurantOrdersUrl = `http://localhost:${RESTAURANT_PORT}/orders`;
      }

      while (Date.now() - startTime < timeoutMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        try {
          const statusRes = await fetch(restaurantOrdersUrl);
          if (statusRes.ok) {
            const currentOrders = await statusRes.json();
            const currentStatus = currentOrders[orderId];
            if (currentStatus && currentStatus !== lastKnownStatus) {
              lastKnownStatus = currentStatus;
              console.log(`[Restaurace] 🔄 Stav objednávky ${orderId}: "${currentStatus}"`);
            }
            if (currentStatus === 'Doruceno' || currentStatus === 'Doručeno') {
              console.log(`[Restaurace] 🎉 Objednávka ${orderId} byla úspěšně doručena!`);
              finalStatus = currentStatus;
              break;
            }
          }
        } catch (_) {}
      }
    }

    return { status: res.status, body, finalStatus };
  } catch (err) {
    console.error('❌ Chyba při odesílání objednávky:', err.message);
    console.error(`Ujistěte se, že kurýrní server běží na ${courierUrl}.`);
    throw err;
  }
}

if (require.main === module) {
  sendOrder().catch(() => process.exit(1));
}

module.exports = { sendOrder };
