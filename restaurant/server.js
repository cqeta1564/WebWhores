const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const SHARED_SECRET = process.env.SHARED_SECRET || 'super-tajne-heslo-123';

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const orders = {};
const processedEvents = new Set();

app.post('/update', (req, res) => {
  const sigHeader = (req.get('X-Signature') || '').trim();
  const rawBody = req.rawBody || JSON.stringify(req.body);

  const expectedSig = crypto.createHmac('sha256', SHARED_SECRET)
                            .update(rawBody, 'utf8')
                            .digest('hex');

  // Overeni podpisu
  if (sigHeader !== expectedSig) {
    console.log('Neplatny podpis webhooku!');
    return res.status(401).send('Unauthorized');
  }

  const { id, event_id, status } = req.body || {};

  // Kontrola duplicit
  if (event_id) {
    if (processedEvents.has(event_id)) {
      console.log(`Duplicitni notifikace ${event_id}, preskakuji.`);
      return res.sendStatus(200);
    }
    processedEvents.add(event_id);
  }

  if (id && status) {
    orders[id] = status;
    console.log(`Prijat webhook pro ${id}: ${status}`);
  }

  res.sendStatus(200);
});

app.get('/orders', (req, res) => {
  res.json(orders);
});

app.listen(PORT, () => {
  console.log(`Restaurant runs on http://localhost:${PORT}`);
});
