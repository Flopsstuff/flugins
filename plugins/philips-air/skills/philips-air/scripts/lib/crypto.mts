// crypto.mts — the payload envelope Philips air devices wrap status and
// control messages in. Port of aioairctrl.coap.encryption.EncryptionContext.
//
//   envelope = key(8 hex) + ciphertext(hex, upper) + SHA256(key + ciphertext)(64 hex, upper)
//
// `key` is a 32-bit counter rendered as 8 uppercase hex chars, bumped before
// every encrypt. AES-128-CBC key and IV are derived as
// MD5("JiangPan" + key) → 32 uppercase hex chars → first 16 CHARACTERS are the
// key, last 16 CHARACTERS the IV. The ASCII bytes of those characters are used
// as-is — they are NOT hex-decoded. PKCS#7 padding.

import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SECRET = 'JiangPan';

export class DigestMismatch extends Error {
  constructor() { super('payload digest mismatch'); this.name = 'DigestMismatch'; }
}

function md5Upper(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

function sha256Upper(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase();
}

function keyAndIv(clientKey: string): [Buffer, Buffer] {
  const h = md5Upper(SECRET + clientKey);
  return [Buffer.from(h.slice(0, 16), 'ascii'), Buffer.from(h.slice(16, 32), 'ascii')];
}

/** Random 4-byte nonce for POST /sys/dev/sync, e.g. "1A2B3C4D". */
export function syncNonce(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export function isClientKey(s: string): boolean {
  return /^[0-9A-Fa-f]{8}$/.test(s);
}

export class EncryptionContext {
  private clientKey: string | null = null;

  setClientKey(key: string): void {
    if (!isClientKey(key)) throw new Error(`sync returned an invalid client key ${JSON.stringify(key)}`);
    this.clientKey = key.toUpperCase();
  }

  get hasKey(): boolean { return this.clientKey !== null; }

  private nextKey(): string {
    if (this.clientKey === null) throw new Error('client key not set — sync first');
    const n = (parseInt(this.clientKey, 16) + 1) % 0x1_0000_0000;
    this.clientKey = n.toString(16).toUpperCase().padStart(8, '0');
    return this.clientKey;
  }

  encrypt(plaintext: string): string {
    const key = this.nextKey();
    const [aesKey, iv] = keyAndIv(key);
    const c = createCipheriv('aes-128-cbc', aesKey, iv);
    const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]).toString('hex').toUpperCase();
    return key + ciphertext + sha256Upper(key + ciphertext);
  }

  decrypt(envelope: string): string {
    return decryptEnvelope(envelope);
  }
}

/** Decryption needs no session state: the key travels in the envelope. */
export function decryptEnvelope(envelope: string): string {
  const s = envelope.trim();
  if (s.length < 8 + 32 + 64) throw new Error(`encrypted payload too short (${s.length} chars)`);
  const key = s.slice(0, 8);
  const ciphertext = s.slice(8, -64);
  const digest = s.slice(-64);
  if (sha256Upper(key + ciphertext) !== digest.toUpperCase()) throw new DigestMismatch();
  if (!/^[0-9A-Fa-f]*$/.test(ciphertext) || ciphertext.length % 32 !== 0) throw new Error('ciphertext is not whole AES blocks of hex');
  const [aesKey, iv] = keyAndIv(key);
  const d = createDecipheriv('aes-128-cbc', aesKey, iv);
  return Buffer.concat([d.update(Buffer.from(ciphertext, 'hex')), d.final()]).toString('utf8');
}
