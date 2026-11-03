/**
 * End-to-End ověření komunikace mezi Kurýrem a Restaurací
 * Testuje Úlohy 2, 3, 4, 5 a 6 v reálném běhu dvou serverů
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const COURIER_PORT = 3000;
const RESTAURANT_PORT = 3001;

const courierServerPath = fs.existsSync(path.join(ROOT_DIR, 'server.js'))
  ? path.join(ROOT_DIR, 'server.js')
  : path.join(ROOT_DIR, 'courier', 'server.js');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`Server na ${url} se nepodařilo spustit do ${timeoutMs}ms`);
}

async function runE2E() {
  console.log('==================================================');
  console.log('🚀 Spouštím End-to-End integrační test (Kurýr + Restaurace)');
  console.log('==================================================\n');

  // Spuštění kurýra se zkráceným STEP_DELAY na 600ms pro rychlý test
  const courierProcess = spawn(process.execPath, [courierServerPath], {
    env: { ...process.env, PORT: String(COURIER_PORT), STEP_DELAY: '600' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  courierProcess.stdout.on('data', d => process.stdout.write(`  [Kurýr stdout] ${d}`));
  courierProcess.stderr.on('data', d => process.stderr.write(`  [Kurýr stderr] ${d}`));

  // Spuštění restaurace
  const restaurantProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(RESTAURANT_PORT), COURIER_URL: `http://localhost:${COURIER_PORT}/order` },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  restaurantProcess.stdout.on('data', d => process.stdout.write(`  [Restaurace stdout] ${d}`));
  restaurantProcess.stderr.on('data', d => process.stderr.write(`  [Restaurace stderr] ${d}`));

  try {
    console.log('1. Čekám na připravenost obou serverů...');
    await waitForServer(`http://localhost:${COURIER_PORT}/orders`);
    await waitForServer(`http://localhost:${RESTAURANT_PORT}/orders`);
    console.log('   Oba servery jsou online.\n');

    const testOrderId = `obj_e2e_${Date.now()}`;

    console.log(`2. Odesílám objednávku ${testOrderId} přes send-order.js skript...`);
    const { sendOrder } = require('./send-order');
    const sendResult = await sendOrder(testOrderId, `http://localhost:${RESTAURANT_PORT}/update`);
    assert.strictEqual(sendResult.status, 202, 'Kurýr měl vrátit HTTP 202 Accepted');
    console.log('   Objednávka úspěšně přijata kurýrem (202 Accepted).\n');

    console.log('3. Čekám na dokončení všech fází webhooků (Restaurace připravuje, Rozváží se, Doručeno + retry)...');
    // 3 kroky po 600ms + simulace duplikátu po 1000ms = cca 3 sekundy celkem
    let finalStatus = null;
    for (let i = 0; i < 35; i++) {
      await sleep(200);
      const res = await fetch(`http://localhost:${RESTAURANT_PORT}/orders`);
      const orders = await res.json();
      if (orders[testOrderId] === 'Doručeno' || orders[testOrderId] === 'Doruceno') {
        finalStatus = orders[testOrderId];
        break;
      }
    }

    assert.ok(finalStatus === 'Doručeno' || finalStatus === 'Doruceno', `Objednávka ${testOrderId} nedosáhla stavu Doručeno/Doruceno! Aktualni stav: ${finalStatus}`);
    console.log(`   ✅ Finální stav v orders je "${finalStatus}".\n`);

    console.log('4. Kontrola audit logu a deduplikace event_id...');
    const auditRes = await fetch(`http://localhost:${RESTAURANT_PORT}/api/events`);
    const auditEvents = await auditRes.json();

    const orderEvents = auditEvents.filter(e => e.id === testOrderId);
    console.log(`   Celkem přijato ${orderEvents.length} webhook notifikací pro tuto objednávku.`);

    const hasDuplicateDetected = orderEvents.some(e => e.isDuplicate);
    assert.ok(hasDuplicateDetected, 'Měl být zachycen a ignorován alespoň jeden duplikát (retry)!');
    console.log('   ✅ Úloha 6: Záměrný retry duplikát byl úspěšně detekován a ignorován.');

    const allSigsValid = orderEvents.every(e => e.signatureValid);
    assert.ok(allSigsValid, 'Všechny doručené notifikace měly mít platný X-Signature');
    console.log('   ✅ Úloha 5: Všechny webhook notifikace měly platný kryptografický HMAC-SHA256 podpis.');

    console.log('\n==================================================');
    console.log('🎉 E2E TEST KOMPLETNĚ ÚSPĚŠNÝ!');
    console.log('==================================================');
  } finally {
    courierProcess.kill();
    restaurantProcess.kill();
  }
}

if (require.main === module) {
  runE2E().catch(err => {
    console.error('❌ E2E test selhal:', err);
    process.exit(1);
  });
}

module.exports = { runE2E };
