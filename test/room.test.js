import { Room } from '../lib/room.js';
import { encrypt, signAnnounce } from '../lib/pqc.js';

const results = [];
function check(name, condition) {
  results.push({ name, pass: !!condition });
  console.log(`${condition ? '✓' : '✗'} ${name}`);
}

const flush = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function makeBus() {
  const subs = [];
  return {
    subscribe(fn) {
      subs.push(fn);
    },
    async publish(from, message) {
      await flush();
      for (const fn of subs) await from.enqueue(() => fn(from, message));
    },
    async pump(room) {
      for (const message of room.takeOutbound()) await this.publish(room, message);
    }
  };
}

async function main() {
  const bus = makeBus();
  const events = { alice: [], bob: [] };

  const alice = new Room({
    username: 'alice',
    room: 'testroom',
    passphrase: 'correct horse battery staple',
    onEvent: (e) => events.alice.push(e)
  });
  const bob = new Room({
    username: 'bob',
    room: 'testroom',
    passphrase: 'correct horse battery staple',
    onEvent: (e) => events.bob.push(e)
  });

  bus.subscribe((from, message) => {
    if (from === alice) return bob.handle(message);
    return alice.handle(message);
  });

  await alice.init();
  await bob.init();

  await bus.publish(alice, alice.announce());
  check('bob discovers alice', bob.knownPeers().includes('alice'));
  await bus.pump(bob);

  await bus.publish(bob, bob.announce());
  check('alice discovers bob', alice.knownPeers().includes('bob'));
  await bus.pump(alice);

  check('channels open both ways', alice.listPeers().includes('bob') && bob.listPeers().includes('alice'));

  alice.broadcast('hello from alice');
  await bus.pump(alice);
  const got = events.bob.filter((e) => e.type === 'message');
  check('bob decrypted the broadcast', got.length === 1 && got[0].plaintext === 'hello from alice');

  alice.directMessage('bob', 'secret dm');
  await bus.pump(alice);
  const dm = events.bob.filter((e) => e.type === 'message' && e.isDm);
  check('dm delivered and flagged', dm.length === 1 && dm[0].plaintext === 'secret dm');

  bob.broadcast('copy that');
  await bus.pump(bob);
  const reply = events.alice.filter((e) => e.type === 'message');
  check('bob reply reached alice', reply.length === 1 && reply[0].plaintext === 'copy that');

  const bigFile = { filename: 'blob.bin', mimeType: 'application/octet-stream', data: 'A'.repeat(300000) };
  alice.sendFile(bigFile);
  const queued = alice.takeOutbound();
  const oversize = queued.filter((m) => JSON.stringify(m).length > 3800);
  check('every file chunk fits the ntfy limit', oversize.length === 0 && queued.length > 1);

  for (const message of queued) await bus.publish(alice, message);
  const fileEvent = events.bob.find((e) => e.type === 'file');
  check('300KB file transferred intact', !!fileEvent && fileEvent.payload.data === bigFile.data);

  alice.broadcast('tamper me');
  const forged = alice.takeOutbound()[0];
  forged.body = Buffer.from('nonsense').toString('base64');
  await bus.publish(alice, forged);
  check('forged ciphertext rejected', events.bob.filter((e) => e.type === 'message').length === 2);

  const noChannel = new Room({ username: 'carol', room: 'testroom', passphrase: 'x', onEvent: () => {} });
  await noChannel.init();
  check('isolated peer cannot send', noChannel.broadcast('nobody') === 0);

  const PHRASE = 'correct horse battery staple';
  check('announces carry a mac', typeof alice.announce().mac === 'string');
  check(
    'same passphrase derives the same announce key',
    alice.keys.announceKey.equals(
      new Room({ username: 'x', room: 'testroom', passphrase: PHRASE, onEvent: () => {} }).keys.announceKey
    )
  );
  check(
    'a different passphrase derives different keys',
    !alice.keys.announceKey.equals(
      new Room({ username: 'x', room: 'testroom', passphrase: 'other', onEvent: () => {} }).keys.announceKey
    )
  );
  check(
    'the same passphrase in another room derives different keys',
    !alice.keys.announceKey.equals(
      new Room({ username: 'x', room: 'otherroom', passphrase: PHRASE, onEvent: () => {} }).keys.announceKey
    )
  );

  const eveLog = [];
  const eve = new Room({
    username: 'observer',
    room: 'testroom',
    passphrase: PHRASE,
    onEvent: (e) => eveLog.push(e)
  });
  await eve.init();

  await eve.handle(alice.announce());
  check('valid signed announce is accepted', eve.knownPeers().includes('alice'));

  const tampered = alice.announce();
  tampered.id = '0'.repeat(32);
  await eve.handle(tampered);
  check('announce with a swapped id is rejected', !eve.peers.has(tampered.id));

  const outsider = new Room({ username: 'alice', room: 'testroom', passphrase: 'wrong phrase', onEvent: () => {} });
  await outsider.init();
  const peerCount = eve.peers.size;
  await eve.handle(outsider.announce());
  check('announce signed with the wrong passphrase is rejected', eve.peers.size === peerCount);
  check('rejection is surfaced to the user', eveLog.some((e) => e.type === 'rejected'));

  const staleTs = Date.now() - 10 * 60 * 1000;
  const staleFields = {
    tag: eve.tag,
    id: alice.id,
    key: alice.publicKey,
    username: 'alice',
    ts: staleTs
  };
  const stale = {
    type: 'public-key',
    id: alice.id,
    key: alice.publicKey,
    ts: staleTs,
    payload: encrypt(alice.keys.announceKey, JSON.stringify({ u: 'alice', t: staleTs })),
    mac: signAnnounce(alice.keys.announceMac, staleFields)
  };
  const rejectsBefore = eveLog.filter((e) => e.reason === 'stale announce').length;
  await eve.handle(stale);
  check(
    'correctly signed but stale announce is rejected',
    eveLog.filter((e) => e.reason === 'stale announce').length === rejectsBefore + 1
  );

  const tamperedTs = alice.announce();
  tamperedTs.ts = Date.now() - 10 * 60 * 1000;
  await eve.handle(tamperedTs);
  check(
    'rewriting the unsigned header timestamp does not make an announce stale',
    eveLog.filter((e) => e.reason === 'stale announce').length === rejectsBefore + 1
  );

  const impostor = new Room({ username: 'alice', room: 'testroom', passphrase: PHRASE, onEvent: () => {} });
  await impostor.init();
  await eve.handle(impostor.announce());
  check('a second key claiming the same name is flagged', eveLog.some((e) => e.type === 'impersonation'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main();