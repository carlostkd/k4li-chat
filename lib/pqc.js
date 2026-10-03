import {
  createHash,
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual
} from 'crypto';
import { MlKem768 } from 'mlkem';

const KEM = new MlKem768();

export const KEM_NAME = 'ML-KEM-768';
export const MAX_MESSAGE_BYTES = 3800;

export async function generateIdentity() {
  const [publicKey, secretKey] = await KEM.generateKeyPair();
  const pk = Buffer.from(publicKey);
  return {
    publicKey: pk.toString('base64'),
    secretKey: Buffer.from(secretKey)
  };
}

export function peerId(publicKey) {
  return createHash('sha256').update('k4li-peer-id|').update(publicKey).digest('hex').slice(0, 32);
}

function sessionInfo(epk) {
  return createHash('sha256').update('k4li-pqc-session-v1|').update(epk).digest();
}

function deriveKey(sharedSecret, info) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(sharedSecret), Buffer.alloc(32), info, 32));
}

export async function createKeyShare(myPublicKey, peerPublicKey) {
  const [epk] = await KEM.generateKeyPair();
  const [ciphertext, sharedSecret] = await KEM.encap(Buffer.from(peerPublicKey, 'base64'));
  const epkB64 = Buffer.from(epk).toString('base64');

  return {
    epk: epkB64,
    ct: Buffer.from(ciphertext).toString('base64'),
    key: deriveKey(sharedSecret, sessionInfo(epkB64))
  };
}

export async function acceptKeyShare(share, mySecretKey) {
  const sharedSecret = await KEM.decap(Buffer.from(share.ct, 'base64'), Buffer.from(mySecretKey));
  return deriveKey(sharedSecret, sessionInfo(share.epk));
}

export function encrypt(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(key, payload, aad) {
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  if (aad) decipher.setAAD(Buffer.from(aad));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function newTransferId() {
  return randomBytes(8).toString('hex');
}

export function deriveRoomKeys(passphrase, room) {
  if (!passphrase) return null;

  const material = Buffer.from(passphrase, 'utf8');
  const salt = createHash('sha256').update('k4li-room-salt|').update(room).digest();

  return {
    announceKey: Buffer.from(hkdfSync('sha256', material, salt, Buffer.from('k4li-announce-enc-v1'), 32)),
    announceMac: Buffer.from(hkdfSync('sha256', material, salt, Buffer.from('k4li-announce-mac-v1'), 32))
  };
}

export function roomTag(room) {
  return createHash('sha256').update('k4li-room-tag|').update(room).digest('hex').slice(0, 16);
}

function announceCanonical({ tag, id, key, username, ts }) {
  return ['k4li-announce-v1', tag, id, key, username, ts].join('|');
}

export function signAnnounce(macKey, fields) {
  return createHmac('sha256', macKey).update(announceCanonical(fields)).digest('base64');
}

export function verifyAnnounce(macKey, fields, signature) {
  if (!macKey || !signature) return false;
  const expected = createHmac('sha256', macKey).update(announceCanonical(fields)).digest();
  let given;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function fingerprint(publicKey) {
  return createHash('sha256').update('k4li-fp|').update(publicKey).digest('hex').slice(0, 12);
}