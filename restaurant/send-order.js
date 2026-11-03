/**
 * Odeslání objednávky z restaurace na kurýrní server.
 * Kompatibilní se všemi úlohami (Úloha 2, 3, 4, 5, 6).
 */

const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';
const RESTAURANT_PORT = process.env.PORT || 3001;

async function sendOrder(customId, customCallbackUrl) {
  const orderId = customId || process.argv[2] || `obj_${Math.floor(Math.random() * 900 + 100)}`;
  const callbackUrl = customCallbackUrl || process.argv[3] || `http://localhost:${RESTAURANT_PORT}/update`;

  const orderPayload = {
    id: orderId,
    callbackUrl
  };

  console.log(`[Restaurace] 📤 Odesílám objednávku:`, orderPayload);

  try {
    const res = await fetch(COURIER_URL, {
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

    return { status: res.status, body };
  } catch (err) {
    console.error('❌ Chyba při odesílání objednávky:', err.message);
    console.error(`Ujistěte se, že kurýrní server běží na ${COURIER_URL}.`);
    throw err;
  }
}

if (require.main === module) {
  sendOrder().catch(() => process.exit(1));
}

module.exports = { sendOrder };
