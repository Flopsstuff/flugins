# Philips Air+ local CoAP protocol

Reference for reading the scripts and for adding a model profile. Load only when needed.

## Transport

- CoAP over UDP, port **5683**. Every message is **NON** (no ACK/retransmit layer), except
  the status registration, which goes as CON (see below).
- Requests use Uri-Path (11) and, for status, Observe (6). Answers are matched by token.
- Implemented from scratch in `scripts/lib/coap.mts` (`node:dgram`) — no `coap` package.

| path | method | payload | answer |
|---|---|---|---|
| `/sys/dev/info` | GET | — | plain JSON: `product_id`, `device_id`, `name`, `type`, `modelid`, `swversion`, `option` |
| `/sys/dev/sync` | POST | 8 uppercase hex chars (random nonce) | 8 hex chars: the client key counter |
| `/sys/dev/status` | GET + Observe=0 | — | encrypted `{"state":{"reported":{…}}}`, then notifications |
| `/sys/dev/control` | POST | encrypted `{"state":{"desired":{"CommandType":"app","DeviceId":"","EnduserId":"", <fields>}}}` | plain `{"status":"success"}`, or `failed` when the envelope does not decrypt |

`/sys/dev/info` needs no session and no subscription, which is why discovery and the
"is it still the same device at this IP" check use it.

## Envelope (`scripts/lib/crypto.mts`)

```
envelope = key(8 hex) + ciphertext(hex, UPPER) + SHA256(key + ciphertext).hex().UPPER (64)
h        = MD5("JiangPan" + key).hex().UPPER          (32 chars)
AES-128-CBC, key = ASCII bytes of h[0:16], iv = ASCII bytes of h[16:32], PKCS#7
```

- The AES key/IV are the **characters** of the hex digest, not its decoded bytes.
- The client bumps the counter (mod 2^32) before **every** encrypt.
- Decrypt reads the key from the first 8 chars of the answer, checks the digest, then decrypts.
- `selftest.mts` pins this against vectors from the reference Python client (aioairctrl).

## Device quirks seen on a live HU5710/00

Measured on 2026-10-17 against firmware 0.4.7.

- **Status is a subscription, and there is one slot.** GET `/sys/dev/status` with
  Observe=0 registers an observer. The device keeps exactly one: a registration from a
  new endpoint (address, port) replaces the previous one — the old port stops receiving —
  and a registration from the same endpoint and token changes nothing.
- **Notifications are NON and only on change**, 0.4–1 s after it (often two in a row), and
  carry the full `state.reported`. Writing a value the device already has, or an empty
  `control`, notifies nobody. Sensor drift (humidity ±1 %) notifies too. In a stable room
  there can be minutes between notifications; Max-Age says 60 but means nothing here.
- **A registration outlives its process.** NON needs no ACK, so the device never learns
  the listener is gone; whoever binds that port later gets the notifications. Verified
  by binding the port of a process that had exited minutes before and changing the
  backlight.
- **The answer to the registration is unreliable.** Send it as **CON**: the device answers
  with a separate NON response (its own message ID, our token, no empty ACK) after
  1.6–8 s — sometimes. After one answer it tends to stay silent for 15–20 minutes (NON and
  CON alike, any port), while the registration itself still works and notifications flow.
  This is what earlier looked like "short-lived subscriptions jam the device".
- **Do not deregister.** Observe=1 is answered as one more notification; RST was blamed for
  trouble in packet dumps. Neither is needed: the next registration replaces the old one.
- **Hence `lib/session.mts`**: every CLI run binds the port saved in
  `~/.local/state/philips-air/<key>/port`, re-registers from it (a no-op for the device, and
  it takes the slot back from another client), listens, caches every report in
  `state.json`, and exits. `set` is confirmed by the notification it causes; a read that
  hears nothing within `--wait` shows the cache and its age. No background process.
- Decrypt sometimes fails (digest/hex error) — counter desync or a stray message; the
  next notification carries a fresh envelope, so it is skipped.
- After a power-up, status stays silent for about a minute.

## Adding a model profile

1. Pair the device (`setup.mts pair <ip>`) — it is saved even without a profile and works
   in raw mode.
2. Dump the fields: `air.mts status --raw -d <dev>`. Change one setting in the Air+ app or on
   the device, then dump again (or run `air.mts watch 120 -d <dev>` and change things while
   it runs) — the D-code that moves is the one you want.
3. Cross-check codes and value tables with kongo09/philips-airpurifier-coap, which maps
   many models.
4. Copy `scripts/lib/models/hu5710.mts` to `<model>.mts`, adjust `match`, `params`
   (writable, with value labels or a `[min, max, step]` range), `sensors`, `info`,
   `filters`, `quiet`, and add it to `PROFILES` in `scripts/lib/models/index.mts`.
5. Verify every writable param with `air.mts set` on the live device (it waits for the
   device's report and says `MISMATCH` when a value does not stick) and restore the original values.
   `watch` during a change shows every field that moves with it.

## HU5710 field map

Writable: power D03102 (0/1) · mode D0310C (auto 0, sleep 17, medium 19, high 65) ·
backlight D03105 (off 0, medium 115, on 123) · lamp D03135 (off 0, humidity 1, ambient 2) ·
ambient D03137 (warm 1, dawn 2, calm 3, breath 4; only with lamp=ambient) ·
humidity-target D03128 (30..70 step 5) · timer D03110 (off 0, N h = N+1, 1..12 h) ·
beep D03130 · childlock D03103 · standby-sensors D03134 · auto-quickdry D03138 ·
quickdry D03139 (all 0/1).

Read-only: D0310D fan speed (follows mode) · D03125 humidity % · D03224 temperature ×10 °C ·
D0312B humidifying (always 6) · D03240 error code (0 = ok) · D0520D/D05207 pre-filter
hours left/total · D0540E/D05408 NanoProtect left/total · D03211 timer remaining (only
meaningful while D03110 ≠ 0) · D03104 mirrors D03105 · Runtime ms · D01S03 name ·
D01S05 model · D01S04 type · D01S12 firmware · WifiVersion · rssi.
No PM2.5 or allergen sensor on this model.
