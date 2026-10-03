import {
  generateIdentity,
  peerId,
  createKeyShare,
  acceptKeyShare,
  encrypt,
  decrypt,
  newTransferId,
  deriveRoomKeys,
  roomTag,
  signAnnounce,
  verifyAnnounce,
  fingerprint,
  MAX_MESSAGE_BYTES
} from './pqc.js';

const CHUNK_SIZE = 3000;
const ANNOUNCE_MAX_AGE_MS = 60000;

export class Room {
  constructor({ username, room, passphrase, onEvent }) {
    this.username = username;
    this.roomName = room;
    this.onEvent = onEvent;
    this.keys = deriveRoomKeys(passphrase, room);
    this.tag = roomTag(room);
    this.peers = new Map();
    this.claims = new Map();
    this.pendingShares = new Map();
    this.outbound = [];
    this.inbox = new Map();
    this.chain = Promise.resolve();
  }

  get authenticated() {
    return this.keys !== null;
  }

  enqueue(task) {
    this.chain = this.chain.then(task).catch(() => {});
    return this.chain;
  }

  async init() {
    const identity = await generateIdentity();
    this.publicKey = identity.publicKey;
    this.secretKey = identity.secretKey;
    this.id = peerId(this.publicKey);
    this.print = fingerprint(this.publicKey);
    this.claims.set(this.username, this.id);
  }

  announce() {
    const ts = Date.now();
    const fields = {
      tag: this.tag,
      id: this.id,
      key: this.publicKey,
      username: this.username,
      ts
    };

    const message = { type: 'public-key', id: this.id, key: this.publicKey, ts };

    if (this.keys) {
      message.payload = encrypt(this.keys.announceKey, JSON.stringify({ u: this.username, t: ts }));
      message.mac = signAnnounce(this.keys.announceMac, fields);
    } else {
      message.payload = JSON.stringify({ u: this.username, t: ts });
    }

    return message;
  }

  takeOutbound() {
    const messages = this.outbound;
    this.outbound = [];
    return messages;
  }

  async handle(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'public-key') return this.handleAnnounce(message);
    if (message.type === 'key-share') return this.handleKeyShare(message);
    if (message.type === 'message' && message.body) return this.handleMessage(message);
    if (message.type === 'file-chunk') return this.handleFileChunk(message);
    if (message.type === 'file-end') return this.handleFileEnd(message);
  }

  async handleAnnounce(message) {
    const { id, key, payload, mac } = message;
    if (!id || !key || !payload || id === this.id) return;

    let username = 'unknown';
    let ts = 0;

    if (this.keys) {
      try {
        const opened = JSON.parse(decrypt(this.keys.announceKey, payload));
        username = opened.u || 'unknown';
        ts = opened.t || 0;
      } catch {
        this.onEvent({ type: 'rejected', reason: 'unreadable announce' });
        return;
      }

      const valid = verifyAnnounce(
        this.keys.announceMac,
        { tag: this.tag, id, key, username, ts },
        mac
      );
      if (!valid) {
        this.onEvent({ type: 'rejected', username, reason: 'bad signature' });
        return;
      }
    } else {
      try {
        const opened = JSON.parse(payload);
        username = opened.u || 'unknown';
        ts = opened.t || 0;
      } catch {
        return;
      }
    }

    if (!Number.isFinite(ts) || Date.now() - ts > ANNOUNCE_MAX_AGE_MS || ts - Date.now() > 10000) {
      this.onEvent({ type: 'rejected', username, reason: 'stale announce' });
      return;
    }

    const claim = this.claims.get(username);
    if (claim && claim !== id) {
      this.onEvent({ type: 'impersonation', username, holder: this.peers.get(claim)?.username });
    } else {
      this.claims.set(username, id);
    }

    const existing = this.peers.get(id);

    if (existing && existing.publicKey !== key) {
      this.peers.delete(id);
      this.onEvent({ type: 'left', username: existing.username });
    }

    const previous = this.peers.get(id);
    this.peers.set(id, {
      ...(previous || {}),
      publicKey: key,
      username,
      fingerprint: fingerprint(key),
      lastSeen: Date.now()
    });

    if (!previous) {
      this.onEvent({ type: 'join', username });
      const share = await createKeyShare(this.publicKey, key);
      const peer = this.peers.get(id);
      peer.outKey = share.key;
      this.outbound.push({ type: 'key-share', from: this.id, to: id, epk: share.epk, ct: share.ct });
    }

    const waiting = this.pendingShares.get(id);
    if (waiting) {
      this.pendingShares.delete(id);
      await this.applyKeyShare(id, waiting);
    }
  }

  async handleKeyShare(message) {
    const { from, to, epk, ct } = message;
    if (!from || to !== this.id || !epk || !ct) return;

    if (!this.peers.has(from)) {
      this.pendingShares.set(from, { epk, ct });
      return;
    }

    await this.applyKeyShare(from, { epk, ct });
  }

  async applyKeyShare(from, share) {
    const peer = this.peers.get(from);
    if (!peer) return;

    try {
      peer.inKey = await acceptKeyShare(share, this.secretKey);
      peer.lastSeen = Date.now();
      if (!peer.announced) {
        peer.announced = true;
        this.onEvent({ type: 'ready', username: peer.username });
      }
    } catch {}
  }

  handleMessage(message) {
    const peer = this.peers.get(message.from);
    if (!peer || !peer.inKey) return;

    let plaintext;
    try {
      plaintext = decrypt(peer.inKey, message.body, message.from);
    } catch {
      return;
    }

    this.onEvent({
      type: 'message',
      username: peer.username,
      plaintext,
      isDm: message.to === this.id,
      timestamp: message.timestamp
    });
  }

  handleFileChunk(message) {
    const { from, transfer, seq, total, chunk } = message;
    if (!transfer || typeof seq !== 'number' || !total || typeof chunk !== 'string') return;

    let state = this.inbox.get(transfer);
    if (!state) {
      state = { parts: new Array(total), received: 0, from, name: message.name };
      this.inbox.set(transfer, state);
    }
    if (state.parts[seq] === undefined) {
      state.parts[seq] = chunk;
      state.received++;
    }
  }

  handleFileEnd(message) {
    const { from, transfer } = message;
    const peer = this.peers.get(from);
    const state = this.inbox.get(transfer);
    if (!peer || !state || !peer.inKey) return;
    if (state.received !== state.parts.length) return;

    let payload;
    try {
      payload = JSON.parse(decrypt(peer.inKey, state.parts.join(''), transfer));
    } catch {
      return;
    }

    this.inbox.delete(transfer);
    this.onEvent({ type: 'file', username: peer.username, payload });
  }

  broadcast(plaintext) {
    let sent = 0;
    for (const [id, peer] of this.peers.entries()) {
      if (!peer.outKey) continue;
      this.outbound.push({
        type: 'message',
        from: this.id,
        body: encrypt(peer.outKey, plaintext, this.id)
      });
      sent++;
    }
    return sent;
  }

  directMessage(username, plaintext) {
    const entry = [...this.peers.entries()].find(([, peer]) => peer.username === username);
    if (!entry) return { ok: false, reason: `no such user: ${username}` };
    const [id, peer] = entry;
    if (!peer.outKey) return { ok: false, reason: `no secure channel with ${username} yet` };

    this.outbound.push({
      type: 'message',
      from: this.id,
      to: id,
      body: encrypt(peer.outKey, plaintext, this.id)
    });
    return { ok: true };
  }

  sendFile(payload, targetUsername) {
    const targets = targetUsername
      ? [...this.peers.entries()].filter(([, peer]) => peer.username === targetUsername)
      : [...this.peers.entries()];

    if (!targets.length) return { ok: false, reason: `no such user: ${targetUsername}` };

    const sent = [];
    for (const [id, peer] of targets) {
      if (!peer.outKey) continue;

      const transfer = newTransferId();
      const encoded = encrypt(peer.outKey, JSON.stringify(payload), transfer);
      const chunks = [];
      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        chunks.push(encoded.slice(i, i + CHUNK_SIZE));
      }

      chunks.forEach((chunk, seq) => {
        this.outbound.push({
          type: 'file-chunk',
          from: this.id,
          ...(targetUsername ? { to: id } : {}),
          transfer,
          seq,
          total: chunks.length,
          name: payload.filename,
          chunk
        });
      });

      this.outbound.push({
        type: 'file-end',
        from: this.id,
        ...(targetUsername ? { to: id } : {}),
        transfer
      });

      sent.push(peer.username);
    }

    return { ok: sent.length > 0, sent };
  }

  listPeers() {
    return [...this.peers.values()].filter((peer) => peer.inKey).map((peer) => peer.username);
  }

  roster() {
    return [...this.peers.values()]
      .filter((peer) => peer.inKey)
      .map((peer) => ({ username: peer.username, fingerprint: peer.fingerprint }));
  }

  knownPeers() {
    return [...this.peers.values()].map((peer) => peer.username);
  }

  sweep(timeout = 15000) {
    const now = Date.now();
    const gone = [];
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > timeout) {
        this.peers.delete(id);
        if (this.claims.get(peer.username) === id) this.claims.delete(peer.username);
        gone.push(peer.username);
      }
    }
    return gone;
  }

  maxPayloadBytes() {
    return MAX_MESSAGE_BYTES;
  }
}