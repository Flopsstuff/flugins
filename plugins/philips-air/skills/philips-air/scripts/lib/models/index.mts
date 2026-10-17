// index.mts — model registry. To support another device, add a profile file
// next to hu5710.mts and list it here; anything unmatched runs in raw mode.

import { HU5710 } from './hu5710.mts';
import type { Profile } from './types.mts';

export const PROFILES: Profile[] = [HU5710];

export function profileFor(modelid: string | undefined): Profile | undefined {
  if (!modelid) return undefined;
  return PROFILES.find((p) => p.match(modelid));
}

export { Param } from './types.mts';
export type { Profile, Raw } from './types.mts';
