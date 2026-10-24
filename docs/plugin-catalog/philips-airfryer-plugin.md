# Philips Airfryer Plugin

**Name:** `philips-airfryer`

**Description:** Control a Philips connected airfryer (5000 Series XL HD9280 / HD928x, FUSION firmware) through the Philips HomeID / Versuni cloud — email-code login, cook with presets, pause, resume, stop, adjust, keep warm, live status

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** philips, airfryer, air-fryer, hd9280, smart-home, iot, mqtt, aws-iot, versuni

The Philips Airfryer plugin lets Claude Code run a Philips connected airfryer. Say *"включи аэрогриль на 180 на 12 минут"*, *"картошку фри на 200, 15 минут"* or *"сколько осталось?"*. The skill checks the values against what the appliance accepts, sends the program through the cloud and reports what the appliance confirmed.

This airfryer's firmware (FUSION) has no local API, so the plugin uses the same route as the official app: Philips HomeID login, then MQTT over WebSocket to the Versuni AWS IoT relay. All of it is one Node script with no dependencies. It carries its own minimal MQTT 3.1.1 client on Node's built-in `WebSocket`, so there is no `npm install` and no background server.

## Installation

```bash
claude plugin install philips-airfryer@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- **Node.js 22.4+** on `PATH`. It provides the built-in `WebSocket`, which accepts the custom handshake headers that AWS IoT needs.
- A **Philips account** (HomeID / NutriU app) with the airfryer already added and online. Wi-Fi setup of a new appliance is done in the official app.
- No API keys. Login is a one-time code sent to the account email.

## Features

### Skills

- [Philips Airfryer](#philips-airfryer) — log in once, then cook, pause, adjust and check the airfryer in plain language

### Usage

The first request triggers login. The skill asks for the Philips account email, Philips sends a code to it, and the skill asks for that code. After that, just ask:

- "включи аэрогриль на 180 на 12 минут" / "cook at 200 for 15 minutes"
- "запеки курицу" (the skill proposes a temperature and time first, then cooks once you confirm)
- "поставь на паузу", "продолжай", "выключи"
- "сделай 190", "добавь 5 минут"
- "держи тёплым 20 минут"
- "что с аэрогрилем?", "сколько осталось?"

### Configuration

Login state (the HomeID `refresh_token`, the chosen appliance and the account's device list) is stored in `~/.config/philips-airfryer/state.json` with mode 600. Override the path with `$PHILIPS_AIRFRYER_STATE` (see [`.env.example`](https://github.com/Flopsstuff/flugins/blob/main/.env.example)). The file lives outside the plugin directory, so plugin updates keep it.

---

## Philips Airfryer

**Skill:** `philips-airfryer`
**Type:** Model-invoked (automatic) / user-invocable

### Script

| Script | Commands |
|--------|----------|
| `fryer.mjs` | `login <email>`, `login --code <code>`, `status [--json]`, `cook <temp> <minutes> [--preset]`, `set <temp> <minutes> [--preset]`, `start`, `pause`, `resume`, `stop`, `adjust [--temp] [--minutes]`, `warm [minutes]`, `devices [--json]`, `presets`, `info` |

Presets: `manual`, `frozen_snacks`, `fresh_fries`, `chicken`, `fish`, `muffins_cake`, `meat_chops`, `vegetables`, `keep_warm`.

### Key Behaviors

- **Ranges are checked before anything is sent.** Outside 60–200 °C and 1–60 whole minutes, the appliance does not refuse a value: it silently clamps it to 180 °C / 1 min. So the script rejects out-of-range values itself, with exit code 2, before it connects.
- **The program is set the way the appliance requires.** It accepts a program only along `standby → idle → setting → cooking`, with a pause between the steps. `cook` takes about 5 seconds because of that.
- **Every write carries the temperature unit.** Leaving it out switches the appliance to Fahrenheit.
- **The appliance's reply is the confirmation.** A command succeeds when the appliance answers it with status 0; busy answers are retried with jitter, as the official app does.
- **Honest about stale status.** The appliance's Wi-Fi module sometimes keeps serving an old Status snapshot while commands still work. `status` shows the snapshot's age when it is more than two minutes old, and the skill suggests a power cycle when you need a live reading.
- **Nothing runs in the background.** Each command refreshes the token, opens one MQTT connection, does its work and exits, in 2–5 seconds. The rotated `refresh_token` is saved right away.

### Exit Codes

`0` ok · `2` usage or value out of range · `3` cloud unreachable · `4` the appliance did not answer or rejected the command · `78` not logged in, token rejected, or no airfryer on the account, which starts login.

### What the Skill Will NOT Do

- Start heating unless you clearly asked to cook now, or replace a running program without asking
- Send a temperature or time outside the range the appliance accepts
- Run two commands at once (they would race on the rotating login token)
- Set up Wi-Fi on a new appliance; use the official app for that

See the [SKILL.md](https://github.com/Flopsstuff/flugins/blob/main/plugins/philips-airfryer/skills/philips-airfryer/SKILL.md) and the bundled [`docs/protocol.md`](https://github.com/Flopsstuff/flugins/blob/main/plugins/philips-airfryer/skills/philips-airfryer/docs/protocol.md) for the auth flow, MQTT topics, NCP messages and the appliance quirks.
