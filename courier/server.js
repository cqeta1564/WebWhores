const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const STEP_DELAY = process.env.STEP_DELAY ? parseInt(process.env.STEP_DELAY, 10) : 5000;
const SHARED_SECRET = process.env.SHARED_SECRET || 'super-tajne-heslo-123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const orders = {};

// Odeslani webhooku na server restaurace
async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', SHARED_SECRET)
                      .update(body, 'utf8')
                      .digest('hex');

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sig
      },
      body
    });
  } catch (err) {
    console.error('Chyba pri odesilani webhooku:', err.message);
  }
}

// Odeslani notifikace se stavem a event_id
async function dispatchNotification(order, status, retry = false) {
  const eventId = `evt_${order.id}_${Date.now()}`;
  const payload = {
    id: order.id,
    event_id: eventId,
    status
  };

  if (orders[order.id]) {
    orders[order.id].status = status;
    orders[order.id].updatedAt = new Date().toLocaleTimeString();
  }

  console.log(`${order.id}: ${status}`);
  await sendWebhook(order.callbackUrl, payload);

  // Zamerne odeslani duplikatu se stejnym event_id pro overeni idempotence
  if (retry) {
    setTimeout(async () => {
      console.log(`Simulace retry pro ${order.id} (${eventId})`);
      await sendWebhook(order.callbackUrl, payload);
    }, 1000);
  }
}

app.get('/orders', (req, res) => {
  res.json(orders);
});

app.post('/order', (req, res) => {
  const order = req.body;
  console.log(`Prijata objednavka ${order.id}`);

  orders[order.id] = {
    id: order.id,
    status: 'Zadost o objednavku',
    callbackUrl: order.callbackUrl,
    updatedAt: new Date().toLocaleTimeString()
  };

  // 202 Accepted
  res.sendStatus(202);

  // Postupne zmeny stavu
  setTimeout(async () => {
    await dispatchNotification(order, 'Restaurace pripravuje', true);

    setTimeout(async () => {
      await dispatchNotification(order, 'Rozvazi se', false);

      setTimeout(async () => {
        await dispatchNotification(order, 'Doruceno', false);
      }, STEP_DELAY);
    }, STEP_DELAY);
  }, STEP_DELAY);
});

app.listen(PORT, () => {
  console.log(`Courier runs on http://localhost:${PORT}`);
});
