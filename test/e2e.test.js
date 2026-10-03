import { Room } from '../lib/room.js';
import { Transport } from '../lib/transport.js';

const SERVER = process.env.SERVER || 'https://ntfy.sh';
const TOPIC = `k4li-e2e-${Date.now()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(username, log, passphrase) {
  const room = new Room({ username, room: TOPIC, passphrase, onEvent: (e) => log.push([username, e]) });
  const transport = new Transport(SERVER, TOPIC);
  transport.onMessage = (m) =>
    room.enqueue(() => room.handle(m)).then(async () => {
      for (const out of room.takeOutbound()) await transport.publish(out);
    });
  return { room, transport };
}

async function main() {
  const aLog = [];
  const bLog = [];
  const PHRASE = process.env.PASSPHRASE || 'shared-secret-for-e2e';
  const alice = makeClient('alice', aLog, PHRASE);
  const bob = makeClient('bob', bLog, PHRASE);
  const eve = makeClient('mallory', [], 'a-completely-different-secret');

  await alice.room.init();
  await bob.room.init();

  alice.transport.subscribe().catch(() => {});
  await sleep(300);
  bob.transport.subscribe().catch(() => {});

  const step = async (label, fn) => {
    const ok = await fn();
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    return ok;
  };

  let pass = true;

  pass &= await step('alice announces presence', async () => {
    await alice.transport.publish(alice.room.announce());
    await sleep(2500);
    return bob.room.knownPeers().includes('alice');
  });

  pass &= await step('bob learns alice and opens a channel', async () => {
    for (const out of bob.room.takeOutbound()) await bob.transport.publish(out);
    await sleep(2000);
    return bob.room.knownPeers().includes('alice');
  });

  pass &= await step('alice sees bob', async () => {
    await bob.transport.publish(bob.room.announce());
    await sleep(2500);
    return alice.room.knownPeers().includes('bob');
  });

  pass &= await step('secure channels open both ways', async () => {
    for (const out of alice.room.takeOutbound()) await alice.transport.publish(out);
    await sleep(2500);
    return alice.room.listPeers().includes('bob') && bob.room.listPeers().includes('alice');
  });

  pass &= await step('alice message reaches bob intact', async () => {
    const before = bLog.length;
    alice.room.broadcast('attack at dawn');
    for (const out of alice.room.takeOutbound()) await alice.transport.publish(out);
    await sleep(2000);
    const got = bLog.slice(before).find(([, e]) => e.type === 'message');
    console.log(`      bob received: ${got ? JSON.stringify(got[1].plaintext) : 'nothing'}`);
    return got && got[1].plaintext === 'attack at dawn';
  });

  pass &= await step('bob reply reaches alice intact', async () => {
    const before = aLog.length;
    bob.room.broadcast('copy that');
    for (const out of bob.room.takeOutbound()) await bob.transport.publish(out);
    await sleep(2000);
    const got = aLog.slice(before).find(([, e]) => e.type === 'message');
    console.log(`      alice received: ${got ? JSON.stringify(got[1].plaintext) : 'nothing'}`);
    return got && got[1].plaintext === 'copy that';
  });

  pass &= await step('direct message is delivered and flagged', async () => {
    const before = bLog.length;
    alice.room.directMessage('bob', 'psst');
    for (const out of alice.room.takeOutbound()) await alice.transport.publish(out);
    await sleep(2000);
    const got = bLog.slice(before).find(([, e]) => e.type === 'message');
    return got && got[1].isDm === true && got[1].plaintext === 'psst';
  });

  pass &= await step('a peer with the wrong passphrase cannot join', async () => {
    await eve.room.init();
    eve.transport.subscribe().catch(() => {});
    for (const out of eve.room.takeOutbound()) await eve.transport.publish(out);
    await eve.transport.publish(eve.room.announce());
    await sleep(3000);
    const aliceRejected = aLog.some(([, e]) => e.type === 'rejected');
    const joined = alice.room.knownPeers().includes('mallory');
    console.log(`      alice rejected it: ${aliceRejected}, roster shows mallory: ${joined}`);
    return !joined && aliceRejected;
  });

  pass &= await step('a peer with the right passphrase still joins', async () => {
    const dave = makeClient('dave', [], PHRASE);
    await dave.room.init();
    dave.transport.subscribe().catch(() => {});
    await dave.transport.publish(dave.room.announce());
    await sleep(3000);
    for (const out of dave.room.takeOutbound()) await dave.transport.publish(out);
    await sleep(1500);
    return alice.room.knownPeers().includes('dave');
  });

  console.log(`\ntopic: ${SERVER}/${TOPIC}`);
  process.exit(pass ? 0 : 1);
}

main();