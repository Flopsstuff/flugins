#!/usr/bin/env node
// Philips HD928x airfryer (FUSION firmware) through the Versuni cloud.
// Every command opens one MQTT connection, does its work and exits.

import { CloudAuthError, CloudConnectionError } from "./lib/cloud.mjs";
import { MqttError } from "./lib/mqtt.mjs";
import { STATE_FILE } from "./lib/state.mjs";
import {
  AirFryer,
  AirFryerError,
  KEEP_WARM_C,
  NotLoggedInError,
  PRESETS,
  ValueError,
  checkRanges,
  formatStatus,
  loginFinish,
  loginStart,
  refreshDevices,
  snapshotAgeSec,
} from "./lib/fryer.mjs";

const EXIT = { ok: 0, usage: 2, unreachable: 3, appliance: 4, login: 78 };

const USAGE = `Usage: fryer.mjs <command> [options]

  login <email>                       send a one-time code to the HomeID email
  login --code <code>                 confirm the code, save the token
  status [--json]                     current state of the appliance
  cook <temp> <minutes> [--preset P]  configure and start
  set  <temp> <minutes> [--preset P]  configure, do not start
  start | pause | resume | stop
  adjust [--temp N] [--minutes N]     change a running program
  warm [minutes]                      keep warm (always ${KEEP_WARM_C} °C), default 30 min
  devices [--json]                    devices on the account
  presets                             preset names (offline)
  info                                shadow, all ports, Config (JSON)

Temperature: integer °C 60–200. Time: integer minutes 1–60.
State file: ${STATE_FILE}`;

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) {
      const name = a.slice(2);
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${a} needs a value`);
      flags[name] = value;
    } else positional.push(a);
  }
  return { positional, flags };
}

function num(value, what) {
  if (value === undefined) throw new UsageError(`missing ${what}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UsageError(`${what} is not a number: ${value}`);
  return n;
}

function preset(flags) {
  const name = flags.preset ?? "manual";
  if (!(name in PRESETS)) {
    throw new UsageError(`unknown preset "${name}"; one of: ${Object.keys(PRESETS).join(", ")}`);
  }
  return name;
}

async function withFryer(fn) {
  const af = new AirFryer();
  try {
    await af.connect();
    return await fn(af);
  } finally {
    await af.close();
  }
}

const commands = {
  async login({ positional, flags }) {
    if (flags.code) {
      const { devices, fryer } = await loginFinish(flags.code);
      for (const d of devices) {
        console.log(`${d.ctn ?? "?"}  ${d.name ?? ""}  ${d.thingName ?? "?"}`);
      }
      if (!fryer) {
        console.log("Logged in, but no airfryer (HD9xxx) on this account.");
        return EXIT.login;
      }
      console.log(`Logged in. Airfryer: ${fryer.ctn} (${fryer.thingName}).`);
      return EXIT.ok;
    }
    const email = positional[0];
    if (!email) throw new UsageError("login needs an email, or --code <code>");
    await loginStart(email);
    console.log(`Code sent to ${email}. Next: login --code <code>`);
    return EXIT.ok;
  },

  async status({ flags }) {
    const st = await withFryer((af) => af.status());
    if (flags.json) {
      console.log(JSON.stringify({ ...st, snapshot_age_sec: snapshotAgeSec(st) }, null, 2));
    } else {
      console.log(formatStatus(st));
    }
    return EXIT.ok;
  },

  async cook({ positional, flags }) {
    const temp = num(positional[0], "temperature");
    const minutes = num(positional[1], "minutes");
    const p = preset(flags);
    checkRanges(temp, minutes, PRESETS[p]);
    await withFryer((af) => af.cook(temp, minutes, p));
    console.log(`cooking: ${temp}°C, ${minutes} min, ${p}`);
    return EXIT.ok;
  },

  async set({ positional, flags }) {
    const temp = num(positional[0], "temperature");
    const minutes = num(positional[1], "minutes");
    const p = preset(flags);
    checkRanges(temp, minutes, PRESETS[p]);
    await withFryer((af) => af.configure(temp, minutes, p));
    console.log(`set: ${temp}°C, ${minutes} min, ${p} (not started — run start)`);
    return EXIT.ok;
  },

  async adjust({ flags }) {
    const temp = flags.temp !== undefined ? num(flags.temp, "--temp") : null;
    const minutes = flags.minutes !== undefined ? num(flags.minutes, "--minutes") : null;
    if (temp === null && minutes === null) throw new UsageError("adjust needs --temp and/or --minutes");
    checkRanges(temp, minutes);
    await withFryer((af) => af.adjust({ temp, minutes }));
    const what = [temp !== null && `${temp}°C`, minutes !== null && `${minutes} min`].filter(Boolean);
    console.log(`adjust: ${what.join(", ")}`);
    return EXIT.ok;
  },

  async warm({ positional }) {
    const minutes = positional[0] !== undefined ? num(positional[0], "minutes") : 30;
    checkRanges(null, minutes);
    await withFryer((af) => af.keepWarm(minutes));
    console.log(`keep warm: ${minutes} min at ${KEEP_WARM_C}°C`);
    return EXIT.ok;
  },

  async devices({ flags }) {
    const state = await refreshDevices();
    const devices = state.devices ?? [];
    if (flags.json) {
      console.log(JSON.stringify({ email: state.email, active: state.thing_name, devices }, null, 2));
      return EXIT.ok;
    }
    console.log(`account: ${state.email ?? "?"}`);
    for (const d of devices) {
      const mark = d.thingName === state.thing_name ? "*" : " ";
      console.log(`${mark} ${d.ctn ?? "?"}  ${d.name ?? ""}  ${d.thingName ?? "?"}`);
    }
    return EXIT.ok;
  },

  async presets() {
    console.log(Object.keys(PRESETS).join("\n"));
    return EXIT.ok;
  },

  async info() {
    const out = await withFryer(async (af) => {
      const [shadow, ports, config] = await Promise.all([
        af.shadow(),
        af.ports(),
        af.getPort("Config"),
      ]);
      return { shadow, ports, config };
    });
    console.log(JSON.stringify(out, null, 2));
    return EXIT.ok;
  },
};

for (const c of ["start", "pause", "resume", "stop"]) {
  commands[c] = async () => {
    await withFryer((af) => af[c]());
    console.log(`${c}: accepted`);
    return EXIT.ok;
  };
}

function exitCodeFor(err) {
  if (err instanceof UsageError || err instanceof ValueError) return EXIT.usage;
  if (err instanceof NotLoggedInError || err instanceof CloudAuthError) return EXIT.login;
  if (err instanceof CloudConnectionError || err instanceof MqttError) return EXIT.unreachable;
  if (err instanceof AirFryerError) return EXIT.appliance;
  return null;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return cmd ? EXIT.ok : EXIT.usage;
  }
  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
    return EXIT.usage;
  }
  try {
    return await handler(parseArgs(rest));
  } catch (err) {
    const code = exitCodeFor(err);
    if (code === null) throw err;
    console.error(`Error: ${err.message}`);
    return code;
  }
}

process.exitCode = await main();
