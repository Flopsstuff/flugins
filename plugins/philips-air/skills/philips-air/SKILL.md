---
name: philips-air
description: >-
  Control Philips air purifiers and humidifiers (HU5710 and similar Air+ devices)
  on the local network over CoAP — no cloud, no app. Use when the user wants to
  turn the purifier/humidifier on or off, change mode (auto/sleep/medium/high),
  set target humidity, dim the display, switch the light ring or ambient scene,
  set the auto-off timer, toggle beep/child lock, check humidity, temperature,
  filter life or errors, watch what changes, or find and add a device on the LAN.
  Triggers: "включи очиститель", "выключи увлажнитель", "поставь влажность 55",
  "режим sleep", "ночной режим", "что с фильтрами", "какая влажность", "сколько
  градусов", "убери подсветку", "таймер на 2 часа", "найди очиститель",
  "добавь очиститель", "turn on the purifier", "set humidity to 50", "filter
  status", Philips, Air+, HU5710.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read AskUserQuestion
  Bash(node --version)
  Bash(node --disable-warning=ExperimentalWarning:*)
---

# Philips air devices over local CoAP

Two scripts, both TypeScript run directly by Node (no build, no dependencies):

- `scripts/air.mts` — day-to-day control of saved devices
- `scripts/setup.mts` — discovery, pairing, the list of saved devices

Below, `air.mts …` and `setup.mts …` are shorthand. Always run the full form:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_SKILL_DIR}/scripts/air.mts" status
node --disable-warning=ExperimentalWarning "${CLAUDE_SKILL_DIR}/scripts/setup.mts" discover
```

(The flag only silences Node's "type stripping is experimental" notice.)

Needs **Node 22.18+ or 23.6+** (native type stripping). If `node --version` is older,
tell the user to upgrade Node; do not try to transpile.

Saved devices live in `~/.config/philips-air/devices.json` (or `$PHILIPS_AIR_CONFIG`).
Devices are addressed by **name or alias**, never by IP: the scripts find the device
again by MAC / device_id if DHCP moved it, and update the config themselves.

## Exit codes — branch on these, not on stderr text

| code | meaning | what to do |
|---|---|---|
| 0 | ok | report the result |
| 2 | usage / bad value | read the message (it lists allowed values), fix the command |
| 3 | device unreachable | it is off, off Wi-Fi, or on another subnet — tell the user |
| 4 | protocol failure (sync, decrypt, control rejected), or no status yet and nothing cached | see "No fresh status" below |
| 5 | `set` was sent but the device reports a different value, or never confirmed it | say which field did not stick, and the note printed with it |
| 78 | no device set up, or the name matches nothing | run **Onboarding** (or show `setup.mts devices`) |

## Onboarding (first use, or "add / find the purifier")

The device must already be on Wi-Fi via the Philips **Air+** app — setting up Wi-Fi from
scratch is out of scope. There is no real pairing: the protocol secret is built in.
"Pairing" means: find the device, run a key sync, prove the encrypted session with a
no-op command, register for status, save it.

1. `setup.mts discover` — sends `GET /sys/dev/info` to every address of the local /24
   (or the real subnet up to /22) and lists whoever answers: name, model, IP, MAC,
   device_id, whether a profile exists for the model, and whether it is already saved.
   Add `--subnet 192.168.0.0/24` if the device lives elsewhere; `--multicast` also asks the
   CoAP multicast group (experimental, may find nothing).
2. Show the list to the user. With one candidate, confirm it in a sentence; with several,
   ask which to add (AskUserQuestion is fine here — the options are the found devices).
3. `setup.mts pair <ip> [--as <key>] [--alias <word>]...` — syncs, checks encryption,
   registers for status, saves. It may print "no status yet" — normal, see below.
   The key defaults to a slug of the device's own name ("Living room" → `living-room`).
   Offer aliases the user will actually say, in their language (`--alias гостиная
   --alias очиститель`). The first saved device becomes the default.
4. Report what was saved and the current reading, if the command printed one.

Housekeeping: `setup.mts devices`, `alias <dev> <word>...`, `unalias`, `rename <dev> <key>`,
`default <dev>`, `forget <dev>`.

## Everyday control

Pick the device with `-d <name|alias>`; omit it when there is a default or only one
device. `-d all` (or `-d a,b`) runs status/get/set on several. Add `--json` when you
need to parse the output.

| user says | command |
|---|---|
| "как там очиститель", "что с воздухом" | `air.mts status` |
| "включи / выключи" | `air.mts set power=on` / `power=off` |
| "ночной режим", "режим sleep" | `air.mts set mode=sleep` |
| "на полную", "посильнее" | `air.mts set mode=high` (then `medium`, `auto`) |
| "поставь влажность 55" | `air.mts set humidity-target=55` |
| "убери подсветку", "погаси экран" | `air.mts set backlight=off` |
| "включи спокойную подсветку" | `air.mts set lamp=ambient ambient=calm` |
| "таймер на 2 часа" / "убери таймер" | `air.mts set timer=2h` / `timer=off` |
| "без звука" | `air.mts set beep=off` |
| "какая влажность / температура" | `air.mts get humidity temperature` |
| "что с фильтрами" | `air.mts get filters` |
| "есть ошибки?" | `air.mts get error-code` |
| "что можно настроить" | `air.mts list` (offline — reads the model from the config) |
| "последи, что меняется" | `air.mts watch 120` (prints device reports as they arrive) |

Rules:

- **Values come from the profile.** `air.mts list` prints every writable parameter with its
  allowed values; `set` rejects anything else with exit 2 and the allowed list. Never
  guess a raw number for a named parameter.
- **`set` verifies itself**: the device reports every change within a second, and `set`
  waits for that report and prints `ok`, `MISMATCH` or `NOT CONFIRMED`. A value the device
  already had produces no report and is printed as `ok (already set …)`. Do not run a
  separate `status` afterwards just to check.
- **Fan speed is not writable.** It follows `mode` (sleep→1, medium→2, high→3). When the
  user asks for "speed 2", set `mode=medium` and say so.
- `ambient` scenes only show while `lamp=ambient` — set both in one command.
- `humidity-target` is 30..70 in steps of 5; round the user's number to the nearest
  allowed one and say that you did.
- Read one thing, answer one thing: for "какая влажность" use `get`, not a full status
  dump. Translate readings into plain language (filter "62% left", not raw hours only).
- Reads may take up to 10 s and may come back from the cache (below). For "what changes
  over time" use `watch`, not repeated `get`.

## Unknown models — raw mode

A device without a profile (anything but HU5710 today) still works: `status --raw`
dumps every reported field, `get D03102` reads one, and `set D03102=1` writes a raw
D-code with **no value checking**. The scripts print a warning each time. Before writing
anything in raw mode, tell the user the value is unchecked and get a yes. To add proper
support, write a profile next to `scripts/lib/models/hu5710.mts` and list it in
`scripts/lib/models/index.mts`; `docs/protocol.md` has the field-mapping workflow.

## How reads work (nothing runs in the background)

Every command does its work and exits. The device keeps a single status subscription; it
outlives the command that made it, so each run re-registers from the same local UDP port
and listens (`~/.local/state/philips-air/<key>/` holds that port and the last report).

- The device **reports every change within a second** while someone listens — that is
  how `set` confirms and how `watch` follows changes.
- It **answers a fresh read only now and then**: after one answer it tends to stay silent
  for 15–20 minutes. So `status`/`get` listen for up to 10 s (`--wait <s>`) and, when
  nothing comes, print the last report with its age ("this is its last report, 25 min
  old"). Pass that on honestly: settings changed by the scripts are current; sensors and
  anything changed on the device itself may have moved since.
- A report under 30 s old (e.g. right after a `set`) is used as is, without asking the
  device.
- Another client that subscribes (the Air+ app, Home Assistant) takes the subscription
  over; the next command takes it back. While it holds it, `set` may print `NOT CONFIRMED`.

## No fresh status

Exit 4 with "sent no status … and nothing is cached yet" means the device has not reported
since pairing (or since the cache was cleared). It is not broken — control still works.
Tell the user the reading is not available right now, and either try again in 15–20
minutes **once**, or, if the user is about to change something anyway, do the `set`: its
confirmation brings the full state with it. Do not retry in a loop — it does not help.

## Diagnostics

- `air.mts info` — plain-text `/sys/dev/info` (no encryption, no subscription).
- `-v` prints protocol chatter; `PHILIPS_AIR_DEBUG=1` traces every CoAP datagram.
- `air.mts --host <ip> status` reads an unsaved device directly — diagnostics only; it
  takes the subscription from the saved port until the next normal command.
- `node --disable-warning=ExperimentalWarning "${CLAUDE_SKILL_DIR}/scripts/selftest.mts"` —
  offline check of the encryption against vectors from the reference Python client.
