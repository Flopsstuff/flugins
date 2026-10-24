// Login state: the HomeID refresh_token, the chosen device and the account's
// device list. Lives outside the plugin directory, which is replaced on every
// plugin update.

import { readFile, writeFile, mkdir, chmod, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

export const STATE_FILE = process.env.PHILIPS_AIRFRYER_STATE
  ? resolve(process.env.PHILIPS_AIRFRYER_STATE)
  : join(configHome, "philips-airfryer", "state.json");

export async function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  const text = await readFile(STATE_FILE, "utf8");
  return text ? JSON.parse(text) : {};
}

// The file holds a long-lived refresh_token: 0700 directory, 0600 file, and an
// atomic rename so a crash mid-write never leaves a truncated token behind.
export async function saveState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, STATE_FILE);
}
