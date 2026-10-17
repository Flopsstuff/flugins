# Philips Air Plugin

**Name:** `philips-air`

**Description:** Control Philips air purifiers and humidifiers (HU5710 and similar Air+ devices) on the local network over encrypted CoAP — LAN discovery, pairing, named devices, status, set with read-back verification

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** philips, air-purifier, humidifier, coap, smart-home, iot, local-control, hu5710

The Philips Air plugin lets Claude Code read and control Philips Air+ purifiers and humidifiers straight over the local network — no Philips cloud, no phone app, no Home Assistant. Say *"включи очиститель"*, *"поставь влажность 55"* or *"что с фильтрами"* and the skill finds the right device by name, talks to it over CoAP with the Air+ payload encryption, and verifies that the change actually stuck.

Everything is two TypeScript scripts that Node runs directly: no build step, no `npm install`, no dependencies. They include their own minimal CoAP codec (`node:dgram`) and the AES envelope (`node:crypto`), which is checked byte for byte against the reference Python client.

## Installation

```bash
claude plugin install philips-air@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- **Node.js 22.18+ or 23.6+** on `PATH`, which can run `.mts` files natively (type stripping).
- The device is **already on Wi-Fi**, set up once through the Philips **Air+** app, and sits on the same subnet as the machine running Claude Code. UDP port 5683 must be reachable.
- No accounts and no API keys. The protocol secret is built into the devices, and each session negotiates its own key.

## Features

### Skills

- [Philips Air](#philips-air) — find devices on the LAN, save them by name, then read and control them

### Usage

The first request triggers onboarding. The skill scans the subnet, shows what it found and saves the device you pick under a friendly name and aliases. After that, just ask in plain language:

- "включи очиститель в гостиной" / "turn the purifier off"
- "ночной режим", "на полную"
- "поставь влажность 55"
- "убери подсветку", "включи спокойную подсветку"
- "таймер на 2 часа"
- "какая влажность и температура?", "что с фильтрами?", "есть ошибки?"
- "последи две минуты, что меняется"

### Configuration

Saved devices live in `~/.config/philips-air/devices.json`; override the path with `$PHILIPS_AIR_CONFIG`. The file holds names, aliases, IP, MAC, model and `device_id`, and no secrets. The last report from each device and the UDP port of its status subscription live in `~/.local/state/philips-air/<device>/`. `PHILIPS_AIR_DEBUG=1` traces every datagram (see [`.env.example`](https://github.com/Flopsstuff/flugins/blob/main/.env.example)).

---

## Philips Air

**Skill:** `philips-air`
**Type:** Model-invoked (automatic) / user-invocable

### Scripts

| Script | Commands |
|--------|----------|
| `setup.mts` | `discover [--subnet] [--multicast]`, `pair <ip> [--as] [--alias]…`, `devices`, `alias`, `unalias`, `rename`, `default`, `forget` |
| `air.mts` | `status [--raw]`, `list`, `get <field>…`, `set name=value…`, `watch [seconds]`, `info`. Options: `-d <name\|alias\|a,b\|all>`, `--host <ip>`, `--wait <s>`, `--json` |
| `selftest.mts` | Offline check of the encryption against Python reference vectors and of the CoAP codec |

### Key Behaviors

- **Discovery without nmap.** `discover` sends a unicast `GET /sys/dev/info` to every address of the local /24 (or the real subnet, up to /22) in parallel and lists every device that answers with device JSON, together with its MAC from the ARP table. This also finds similar devices whose MAC has a different vendor prefix. On a home /24 it takes about 3 seconds.
- **Nothing runs in the background.** The device serves its state only to CoAP observers and keeps exactly one; a subscription outlives the process that made it, and a registration from the same port changes nothing. So every command re-registers from the same saved UDP port, listens, caches what arrives and exits — the session can close right after.
- **Reads are honest about age.** The device reports every change within a second but answers a fresh read only now and then (after one answer it tends to stay silent for 15–20 minutes). `status` and `get` listen for up to 10 s and otherwise show the last report with its age.
- **Pairing proves the session.** `pair` syncs a key and sends an empty encrypted command — the device rejects one it cannot decrypt — before it saves anything, so a saved device is known to work.
- **Names, not IPs.** Commands take a device name or alias. If the device no longer answers at its saved IP, or a different device answers there, the script looks it up again by MAC and then by `device_id`, and updates the config.
- **Model profiles.** Each model maps raw D-codes to named parameters with allowed values (`scripts/lib/models/`). The HU5710 profile covers power, mode, backlight, light ring and ambient scenes, target humidity, timer, beep, child lock and quick-dry, plus the read-only humidity, temperature, filter life and error code. A model without a profile runs in raw mode (`status --raw`, `get`/`set` by D-code) and gets a warning.
- **Verified writes.** `set` validates values against the profile, sends each change through `/sys/dev/control`, waits for the notification the change causes and prints `ok`, `MISMATCH` or `NOT CONFIRMED` (exit code 5). It also refreshes the cache with the device's full state.
- **Retries where the device needs them.** If a control command is rejected, the client re-syncs once and then makes up to 5 more attempts.

### Exit Codes

`0` ok · `2` usage or invalid value · `3` device unreachable · `4` protocol failure (sync, decrypt, rejected command), or no status yet and nothing cached · `5` a written value did not stick or was not confirmed · `78` no device set up yet, or the name matches nothing, which starts onboarding.

### What the Skill Will NOT Do

- Set up Wi-Fi on a factory-fresh device; use the Air+ app for that
- Write unchecked raw values on an unknown model without asking first
- Leave a process running after a command, or retry status reads in a loop

See the [SKILL.md](https://github.com/Flopsstuff/flugins/blob/main/plugins/philips-air/skills/philips-air/SKILL.md) and the bundled [`docs/protocol.md`](https://github.com/Flopsstuff/flugins/blob/main/plugins/philips-air/skills/philips-air/docs/protocol.md) for the protocol, the device quirks and how to add a model profile.
