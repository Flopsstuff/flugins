// cli.mts — exit codes and error reporting shared by setup.mts and air.mts.

import process from 'node:process';
import { CoapTimeout } from './coap.mts';
import { ProtocolError } from './client.mts';
import { SelectError } from './config.mts';
import { UnreachableError } from './device.mts';
import { NoReportError } from './session.mts';

// 0 ok · 1 generic · 2 usage · 3 device unreachable · 4 protocol (sync, decrypt,
// control rejected, no status and nothing cached) · 5 set not confirmed ·
// 78 no device set up / unknown name
export const EXIT = { OK: 0, GENERIC: 1, USAGE: 2, UNREACHABLE: 3, PROTOCOL: 4, MISMATCH: 5, NOT_CONFIGURED: 78 } as const;

export class UsageError extends Error {
  /** print the command summary too — for malformed commands, not for bad values */
  readonly showUsage: boolean;
  constructor(message: string, showUsage = false) { super(message); this.name = 'UsageError'; this.showUsage = showUsage; }
}

export const warn = (line: string) => process.stderr.write(`${line}\n`);

export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError) return EXIT.USAGE;
  if (err instanceof SelectError) return EXIT.NOT_CONFIGURED;
  if (err instanceof UnreachableError || err instanceof CoapTimeout) return EXIT.UNREACHABLE;
  if (err instanceof ProtocolError || err instanceof NoReportError) return EXIT.PROTOCOL;
  return EXIT.GENERIC;
}

export async function main(fn: () => Promise<number | void>, usage: string): Promise<void> {
  try {
    process.exitCode = (await fn()) ?? EXIT.OK;
  } catch (err) {
    const code = exitCodeFor(err);
    warn(`error: ${(err as Error).message}`);
    if (err instanceof UsageError && err.showUsage) warn(`\n${usage}`);
    if (process.env.PHILIPS_AIR_DEBUG && err instanceof Error && err.stack) warn(err.stack);
    process.exitCode = code;
  }
}
