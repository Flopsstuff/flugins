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
| 4 | protocol failure (sync, decrypt, status never answered) | see "Status stops answering" below |
| 5 | `set` was sent but the device reports a different value | say which field did not stick |
| 78 | no device set up, or the name matches nothing | run **Onboarding** (or show `setup.mts devices`) |

## Onboarding (first use, or "add / find the purifier")

The device must already be on Wi-Fi via the Philips **Air+** app — setting up Wi-Fi from
scratch is out of scope. There is no real pairing: the protocol secret is built in.
"Pairing" means: find the device, run a key sync, decrypt one status, save it.

1. `setup.mts discover` — sends `GET /sys/dev/info` to every address of the local /24
   (or the real subnet up to /22) and lists whoever answers: name, model, IP, MAC,
   device_id, whether a profile exists for the model, and whether it is already saved.
   Add `--subnet 192.168.0.0/24` if the device lives elsewhere; `--multicast` also asks the
   CoAP multicast group (experimental, may find nothing).
2. Show the list to the user. With one candidate, confirm it in a sentence; with several,
   ask which to add (AskUserQuestion is fine here — the options are the found devices).
3. `setup.mts pair <ip> [--as <key>] [--alias <word>]...` — syncs, decrypts a status, saves.
   The key defaults to a slug of the device's own name ("Living room" → `living-room`).
   Offer aliases the user will actually say, in their language (`--alias гостиная
   --alias очиститель`). The first saved device becomes the default.
4. Report what was saved and the current reading the command printed.

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
- **`set` verifies itself**: it waits (up to 10 s) for the device to report the new value
  and prints `ok` or `MISMATCH`. Do not run a separate `status` afterwards just to check.
- **Fan speed is not writable.** It follows `mode` (sleep→1, medium→2, high→3). When the
  user asks for "speed 2", set `mode=medium` and say so.
- `ambient` scenes only show while `lamp=ambient` — set both in one command.
- `humidity-target` is 30..70 in steps of 5; round the user's number to the nearest
  allowed one and say that you did.
- Read one thing, answer one thing: for "какая влажность" use `get`, not a full status
  dump. Translate readings into plain language (filter "62% left", not raw hours only).
- Reads are cheap: they come from the observer's cache (below), not from the device.
  For "what changes over time" still use `watch`, not repeated `get`.

## Unknown models — raw mode

A device without a profile (anything but HU5710 today) still works: `status --raw`
dumps every reported field, `get D03102` reads one, and `set D03102=1` writes a raw
D-code with **no value checking**. The scripts print a warning each time. Before writing
anything in raw mode, tell the user the value is unchecked and get a yes. To add proper
support, write a profile next to `scripts/lib/models/hu5710.mts` and list it in
`scripts/lib/models/index.mts`; `docs/protocol.md` has the field-mapping workflow.

## The background observer

The device serves its state only to CoAP observers, and after a handful of short-lived
subscriptions it stops answering status for 15–20 minutes (sync and control keep working).
So the first read of a device starts a small background process, `observer.mts`, that holds
**one** subscription and caches every report in `~/.local/state/philips-air/<key>/`.
`status`, `get` and `watch` read that cache; `set` writes directly and confirms from the
next report. Pairing starts the observer too, so the whole workflow costs the device a
single subscription.

- The device reports on change, so a `status` may say "last report 4 min ago" — that is
  the current state, not stale data.
- The observer exits after 60 minutes without reads (`PHILIPS_AIR_OBSERVER_IDLE`, minutes,
  0 = never) and the next read starts it again.
- `air.mts observer` shows whether it runs and when the device last reported;
  `observer stop` / `observer restart` control it; its log path is printed there.
- Do not start or restart the observer in a loop: every start is a new subscription.

## Status stops answering

Symptom: `air.mts info` answers but `status`/`get`/`set` fail with exit 4 ("no status from
… within 20 s"). The device's status side is jammed — usually by too many subscriptions
from other local scripts or a restarted observer. Tell the user plainly, then:

1. Wait 15–20 minutes and try **once**. It often recovers on its own.
2. If it still fails, ask the user to unplug the device for ~10 s. After power-up, status
   needs about a minute before it answers.

Never retry in a loop — each attempt is another subscription and prolongs the jam.

## Diagnostics

- `air.mts info` — plain-text `/sys/dev/info` (no encryption, no observation).
- `-v` prints protocol chatter; `PHILIPS_AIR_DEBUG=1` traces every CoAP datagram.
- `air.mts --host <ip> status` reads an unsaved device directly — diagnostics only, it
  costs the device a subscription.
- `node --disable-warning=ExperimentalWarning "${CLAUDE_SKILL_DIR}/scripts/selftest.mts"` —
  offline check of the encryption against vectors from the reference Python client.
