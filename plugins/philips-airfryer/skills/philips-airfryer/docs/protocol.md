# Protocol notes

Reference for whoever changes the scripts. Verified against a Philips Airfryer
5000 Series XL HD9280 (SPECTRE board, FUSION firmware 4.0.0 / 0.6.8). The firmware
has **no local API**: all TCP ports are closed and CoAP is silent, so every
interaction goes through the Versuni AWS IoT relay.

## Files

| file | role |
|---|---|
| `scripts/fryer.mjs` | CLI, argument checks, exit codes |
| `scripts/lib/cloud.mjs` | Philips HomeID auth and the Versuni REST endpoints; ported from [renaudallard/homeassistant_philips_homeid](https://github.com/renaudallard/homeassistant_philips_homeid) (BSD-2-Clause, see `scripts/lib/NOTICE.md`) |
| `scripts/lib/mqtt.mjs` | minimal MQTT 3.1.1 client over Node's built-in `WebSocket` |
| `scripts/lib/fryer.mjs` | `AirFryer`: NCP request/response, the Control state machine, presets, status formatting |
| `scripts/lib/state.mjs` | `~/.config/philips-airfryer/state.json` (`$PHILIPS_AIRFRYER_STATE`) |

## Authentication

**Login, once** (`login <email>`, then `login --code <code>`):

1. `POST cdc.accounts.home.id/accounts.auth.otp.email.sendCode` (Gigya, the HomeID
   identity provider) emails a code and returns a `vToken`, kept in the state file
   until step 2.
2. `accounts.auth.otp.email.login` with email, code and `vToken` returns a Gigya
   session (`login_token`). `errorCode 206001` means the account never finished signup
   in the app.
3. OIDC authorization-code flow with PKCE, posing as the Philips mobile app (its
   `client_id` and `redirect_uri com.philips.ka.oneka.app.prod://oauthredirect`):
   - `/authorize?prompt=none` redirects with a `context` JWT;
   - `socialize.getIDs` returns a `gmidTicket`;
   - `/authorize/continue` with `context`, `login_token` and `gmidTicket` redirects
     with `code`;
   - `/token` with `code` and the PKCE verifier returns `access_token`, `id_token`
     and `refresh_token`.
   Redirects are read with `fetch(…, { redirect: "manual" })`.
4. `GET prod.eu-da.iot.versuni.com/api/da/user/self/device` lists the devices; the
   first `ctn` starting with `HD9` becomes `thing_name`.

**Every command:**

1. `/token` with `grant_type=refresh_token`. The response may carry a new
   `refresh_token`; it is written back immediately. This is why two runs must not
   overlap.
2. In parallel: `POST user/self/get-id` (with the `id_token`) returns the MQTT
   `userId`, used as the client-id prefix (`<userId>_<uuid>`); `GET user/self/signature`
   returns the Custom Authorizer signature.
3. WebSocket to `wss://ats.prod.eu-da.iot.versuni.com:443/mqtt`, subprotocol `mqtt`,
   with these handshake headers:

   ```
   x-amz-customauthorizer-name: CustomAuthorizer
   x-amz-customauthorizer-signature: <signature>
   token-header: Bearer <access_token>
   tenant: da
   content-type: application/json
   ```

   A rejected authorizer fails the HTTP upgrade; the WebSocket API does not expose
   the status code, so it surfaces as "WebSocket handshake failed" (exit 3).

## MQTT

MQTT 3.1.1, clean session, keepalive 30 s, no username/password (auth is in the
handshake). Topics:

- publish `da_ctrl/<thing>/to_ncp` — NCP commands, QoS 1
- subscribe `da_ctrl/<thing>/from_ncp` — replies and events
- subscribe `$aws/things/<thing>/shadow/get/accepted` and `.../update/accepted`;
  publish `{}` to `.../shadow/get` to read the shadow

**Do not subscribe to `#` or other wildcards**: it violates the IoT policy and the
broker drops the connection.

## NCP messages

Command (to `to_ncp`):

```json
{"cid":"1a2b3c4d","time":"2026-10-24T15:00:00Z","type":"command","cn":"setPort","ct":"mobile",
 "data":{"portName":"Control","properties":{"status":"cooking"}}}
```

- `cid` — 4 random bytes as hex; the reply carries the same `cid`, which is how
  replies are matched.
- `cn` — `getPort`, `setPort`, `getAllPorts`.

Reply (on `from_ncp`): `{"cid":…, "status":0, "data":{…}}`. Status codes: 0 ok,
1 busy, 2 json_error, 3 correlation_id_error, 4 client_type_error, 5 time_error,
6 message_type_error, 7 command_name_error, 8 port_error, 9 write_read_only_port,
10 read_write_only_port, 11 serialization_error, 12 mqtt_error. **Busy (1) is
retryable**: up to 4 attempts with 300–1000 ms jitter, as the official app does.

Events (on `from_ncp`): `{"type":"event","cn":"updatePort","data":{"portName":"Status","properties":{…}}}`
— merged into `AirFryer.state`.

Ports seen on the HD9280 include `Status` (read), `Control` (write), `Config`
(`ctn` = model), `push_c`, `recipe_c`, `UserServer`; `info` dumps the full list.

`Status` properties: `status`, `temp`, `time` (program, s), `cur_time` (remaining,
s), `preset`, `temp_unit` (`false` = °C), `drw_opn` (basket open), `error`,
`timestamp` (UTC, no `Z`), plus `recipe_id`, `step_id`, `Echo`, `SesOwnId`.

## Appliance quirks

These are what the rules in `SKILL.md` rest on:

- **Control state machine.** A program is accepted only along
  `standby → idle → setting → cooking`. `configure()` writes `idle`, waits
  `STEP_DELAY_MS = 1500`, writes `setting` with temp/time/preset, waits again;
  `start` then writes `cooking`. Shorter delays make the appliance drop the program
  without an error.
- **`temp_unit` on every write.** Leaving it out switches the appliance to
  Fahrenheit. The scripts always send `temp_unit: false`.
- **Silent clamping.** Out-of-range values become 180 °C / 1 min without an error,
  so `checkRanges()` refuses anything outside 60–200 °C and 1–60 whole minutes
  before connecting.
- **`keep_warm` is always 80 °C**, whatever temperature is sent.
- **Status goes stale.** The Wi-Fi module can lose sync with the main board: `getPort
  Status` keeps returning an old snapshot (compare its `timestamp`) while `setPort
  Control` still works. So writes never wait for a Status echo — success is NCP
  status 0 on the reply. A power cycle of the appliance recovers the module.
- Preset ids: manual 0, frozen_snacks 1, fresh_fries 2, chicken 3, fish 4,
  muffins_cake 5, meat_chops 6, vegetables 7, keep_warm 8.
