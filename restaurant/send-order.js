const COURIER_URL = process.env.COURIER_URL || 'http://localhost:3000/order';
const RESTAURANT_PORT = process.env.PORT || 3001;

const order = {
  id: process.argv[2] || 'obj_' + Math.floor(Math.random() * 1000),
  callbackUrl: `http://localhost:${RESTAURANT_PORT}/update`
};

console.log('Odesilam objednavku z restaurace:', order);

fetch(COURIER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(order)
})
  .then(res => {
    console.log('Courier status:', res.status);
  })
  .catch(err => {
    console.error('Chyba pri odesilani:', err.message);
  });
