const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';

const order = {
  id: process.argv[2] || 'objednavka1',
  callbackUrl: 'http://localhost:3001/update'
};

console.log('Odesilam objednavku:', order);

fetch(COURIER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(order)
})
  .then(res => {
    console.log('Odpoved kuryra:', res.status, res.statusText);
  })
  .catch(err => {
    console.error('Chyba:', err.message);
  });
