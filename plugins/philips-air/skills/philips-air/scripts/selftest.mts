#!/usr/bin/env node
// selftest.mts — offline checks: the encryption envelope against vectors
// produced by the reference Python implementation (aioairctrl
// EncryptionContext), plus a CoAP encode/decode round trip. No network.
//
//   node selftest.mts

import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { EncryptionContext, decryptEnvelope, DigestMismatch } from './lib/crypto.mts';
import { encode, decode, pathOptions, uintOption, OPT, TYPE, CODE } from './lib/coap.mts';

// Generated with aioairctrl.coap.encryption.EncryptionContext:
//   e.set_client_key(key); e.encrypt(plaintext)
const VECTORS = [
  {
    key: '0000000A',
    plaintext: 'hello',
    envelope: '0000000BAFFFB1047D55E82661684177FEE5131B8CBDAB70F95C1AFC95D0C1A2CC7A6270E5F1E0DFB73097305CB72D6CF9B372FD',
  },
  {
    key: 'FFFFFFFF', // counter wraps to 00000000
    plaintext: '{"state": {"desired": {"CommandType": "app", "DeviceId": "", "EnduserId": "", "D03105": 0}}}',
    envelope: '000000001A097E525EC88B79D96C66674E79A31B9C8C9F1D3B95D0693DD937B77350AFC9724D01F298A89EBE3A9D716E490E4885CD9E53204E06A18D3D817FB1F39E44C23440D103A7575F950C187D5C7D50DC99AA14867734AEEB8DF464E512F19B83A1D7F9FBFCED5AD5E77C0269CE62AD4AD8435206E605815363EC26C4A02DF59E1B',
  },
  {
    key: '1A2B3C4D', // a full block of plaintext gets a full block of padding
    plaintext: '0123456789abcdef',
    envelope: '1A2B3C4EDED7C5ADD156E3F15FD3BBA1DF0A579D3CFAA1D1E2D214ADA148E1BF72DC42283B7711EED5E427CD48475D0768DB17525438121A94101E5C5B2714B0674E2D43',
  },
  {
    key: '00000000',
    plaintext: '',
    envelope: '00000001C707AD71CCEACE37DFEDD8B91F2B5E962DBA69A7633D9ED8714F7A1E11AF57EE9847F318AFEFA346EE79B058E093CD6C',
  },
];

let n = 0;
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`); };

for (const v of VECTORS) {
  check(`encrypt matches Python for key ${v.key}`, () => {
    const e = new EncryptionContext();
    e.setClientKey(v.key);
    assert.equal(e.encrypt(v.plaintext), v.envelope);
  });
  check(`decrypt Python envelope for key ${v.key}`, () => assert.equal(decryptEnvelope(v.envelope), v.plaintext));
}

check('counter advances on every encrypt', () => {
  const e = new EncryptionContext();
  e.setClientKey('0000000A');
  assert.equal(e.encrypt('x').slice(0, 8), '0000000B');
  assert.equal(e.encrypt('x').slice(0, 8), '0000000C');
});

check('tampered envelope is rejected', () => {
  const bad = VECTORS[0].envelope.replace(/^0000000B/, '0000000C');
  assert.throws(() => decryptEnvelope(bad), DigestMismatch);
});

check('CoAP round trip with Uri-Path, Observe=0 and payload', () => {
  const msg = {
    type: TYPE.NON, code: CODE.GET, mid: 0xbeef, token: Buffer.from('a1b2c3d4', 'hex'),
    options: [...pathOptions('/sys/dev/status'), { number: OPT.OBSERVE, value: uintOption(0) }],
    payload: Buffer.from('hi'),
  };
  const buf = encode(msg);
  // 0x54 = ver 1, NON, TKL 4; Observe (6) sorts before Uri-Path (11).
  assert.equal(buf.subarray(0, 4).toString('hex'), '5401beef');
  assert.equal(buf[8], 0x60);
  const back = decode(buf);
  assert.deepEqual(back.token, msg.token);
  assert.deepEqual(back.options.filter((o) => o.number === OPT.URI_PATH).map((o) => o.value.toString()), ['sys', 'dev', 'status']);
  assert.equal(back.options.find((o) => o.number === OPT.OBSERVE)?.value.length, 0);
  assert.equal(back.payload.toString(), 'hi');
});

check('CoAP extended option delta and length', () => {
  const long = Buffer.alloc(300, 0x61);
  const buf = encode({ type: TYPE.NON, code: CODE.POST, mid: 1, token: Buffer.alloc(0), options: [{ number: 300, value: long }], payload: Buffer.alloc(0) });
  const back = decode(buf);
  assert.equal(back.options[0].number, 300);
  assert.equal(back.options[0].value.length, 300);
});

console.log(`\n${n} checks passed`);
