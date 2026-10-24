---
name: philips-airfryer
description: >-
  Control a Philips connected airfryer (5000 Series XL HD9280 / HD928x, FUSION
  firmware) through the Philips HomeID / Versuni cloud — the firmware has no local
  API. Use when the user wants to start cooking at a temperature and time, pick a
  preset (fries, chicken, fish, vegetables, cake…), configure without starting,
  pause, resume, stop, change temperature or time mid-cook, keep food warm, check
  what the airfryer is doing and how much time is left, or log in to the Philips
  account. Triggers: "аэрогриль", "аэрофритюрница", "включи аэрогриль на 180 на
  12 минут", "запеки курицу", "картошка фри", "поставь на паузу", "выключи
  аэрогриль", "сколько осталось", "что с аэрогрилем", "добавь 5 минут",
  "подогрей", "держи тёплым", "airfryer", "air fryer", "cook at 200 for 15
  minutes", "how long is left", Philips, HomeID, NutriU, HD9280.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read AskUserQuestion
  Bash(node --version)
  Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

# Philips airfryer through the Versuni cloud

One zero-dependency Node script does everything:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/fryer.mjs status
```

Below, `fryer.mjs …` is shorthand for that full form. Needs **Node 22.4+** (built-in
`WebSocket` with custom headers). If `node --version` is older, tell the user to
upgrade Node.

Each command logs in with the saved token, opens one MQTT connection to the cloud,
does its job and exits — 2–3 s for reads, about 5 s for `cook`/`set`. Nothing runs in
the background. Login state lives in `~/.config/philips-airfryer/state.json`
(or `$PHILIPS_AIRFRYER_STATE`), mode 600.

**Run one `fryer.mjs` at a time — never in parallel.** Every run rotates the saved
`refresh_token`; two runs racing each other can leave a token the cloud no longer
accepts, and the user would have to log in again.

## Exit codes — branch on these, not on stderr text

| code | meaning | what to do |
|---|---|---|
| 0 | ok | report the result |
| 2 | usage or value out of range | read the message (it states the allowed range or presets), fix the command or ask the user |
| 3 | cloud unreachable (network, DNS, broker refused the connection) | tell the user; retry once a bit later at most |
| 4 | the appliance did not answer or rejected the command | see "When a command fails" |
| 78 | not logged in, the token was rejected, or no airfryer on the account | run **Login** |

## Login (first use, or exit 78)

The airfryer must already be added to the user's Philips account in the official app
(HomeID / NutriU). Wi-Fi setup is out of scope.

1. Ask for the email of that Philips account. Do not guess it.
2. `fryer.mjs login <email>` — Philips emails a one-time code.
3. Ask the user for the code from the email.
4. `fryer.mjs login --code <code>` — prints the account's devices and picks the first
   airfryer (`HD9…`). Exit 78 here means the code was wrong or expired, or the account
   has no airfryer: say which (the message tells), and for a bad code go back to step 2.

Log in again only after exit 78, never "just in case".

## Everyday control

| user says | command |
|---|---|
| "что с аэрогрилем", "сколько осталось" | `fryer.mjs status` |
| "включи на 180 на 12 минут" | `fryer.mjs cook 180 12` |
| "картошку фри, 200 градусов, 15 минут" | `fryer.mjs cook 200 15 --preset fresh_fries` |
| "настрой, но не запускай" | `fryer.mjs set 180 12 --preset chicken`, later `fryer.mjs start` |
| "пауза" / "продолжай" | `fryer.mjs pause` / `fryer.mjs resume` |
| "выключи", "стоп" | `fryer.mjs stop` |
| "сделай 190", "ещё 5 минут" | `fryer.mjs adjust --temp 190` / `fryer.mjs adjust --minutes <new total>` |
| "держи тёплым 20 минут" | `fryer.mjs warm 20` |
| "какие есть режимы" | `fryer.mjs presets` |

Presets: `manual` (default), `frozen_snacks`, `fresh_fries`, `chicken`, `fish`,
`muffins_cake`, `meat_chops`, `vegetables`, `keep_warm`.

Rules:

- **Temperature and time are always required** for `cook`/`set`. A preset is sent along
  with them and does not choose them; if the user names only a dish, propose a
  temperature and time and confirm before cooking.
- **Ranges: 60–200 °C, 1–60 whole minutes.** The appliance silently clamps anything
  else to 180 °C / 1 min, so the script refuses it with exit 2. Never pass a value
  outside the range hoping it works. Round fractional minutes to the nearest whole
  minute and say that you did; for a temperature out of range, tell the user the limit.
- **`warm` always runs at 80 °C** — the appliance ignores any other temperature for
  keep-warm. Say so if the user asked for a different one.
- **`adjust --minutes N` sends N as the program time** (the same field `cook` sets), not
  an increment. For "ещё 5 минут", read `status` first and add to the current time.
- **Starting heat is a physical action.** Run `cook`/`start`/`resume` only when the user
  clearly asked to cook now. If `status` shows a program already `cooking` or `pause`,
  ask before replacing it with a new `cook`. If it shows `BASKET OPEN`, tell the user
  before starting.
- **"accepted" is the confirmation.** A command succeeds when the appliance answers
  the cloud with status 0; the script prints `accepted` / the settings it sent. Do not
  run `status` afterwards just to verify — see the next section for why it can lie.

## Status can be stale

`status` reads the appliance's Status port. Sometimes the Wi-Fi module loses sync with
the main board and keeps returning an old snapshot, while commands still work. The
script flags this: `(snapshot N min old — may be stale)` in the text output,
`snapshot_age_sec` in `--json`. When you see it:

- say the reading is old and may not reflect reality;
- commands are still fine to send;
- the fix is a **power cycle** of the airfryer (unplug for a few seconds). Suggest it
  if the user needs a live reading.

Statuses: `standby` (on, nothing set) → `idle` → `setting` (program set, not started)
→ `cooking` ⇄ `pause` → `finish`. In `status`, `remaining` counts down the program
time; `error` other than 0 is an appliance error code — report it as is.

## When a command fails (exit 4)

- `No reply from the appliance` — it is likely unplugged or off Wi-Fi (the cloud
  answers, the appliance does not). Ask the user to check it; `fryer.mjs info` shows
  `connected` in the device shadow.
- `setPort Control …: <reason>` — the appliance rejected the write. Read `status` to see
  which state it is in (for example, `start` with nothing `set`) and tell the user.
- `busy` after retries — the appliance is mid-transition; wait a few seconds and retry
  **once**.

## Diagnostics

- `fryer.mjs devices` — the account's devices from the cloud, `*` marks the one in use.
- `fryer.mjs info` — device shadow (firmware, `powerOn`, `connected`), all NCP ports and
  the Config port, as JSON.
- `docs/protocol.md` — auth flow, MQTT topics, NCP messages and the appliance quirks
  behind the rules above. Read it before changing the scripts.
