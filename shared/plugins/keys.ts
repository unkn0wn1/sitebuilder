// Official plugin signing keys. Public keys only.
// Key 94a55397b13824c3. The private key lives outside this repository.
import type { OfficialKey } from './signature'

/**
 * Built-in keys that make a package Official.
 * An empty list is valid: every other package is Self-installed until a public key is added.
 */
export const OFFICIAL_KEYS: readonly OfficialKey[] = [
  { id: '94a55397b13824c3', publicKey: 'EZfgHTibbf2fbn3iMx46KHlJBpeLnl/IAti23AGbYSo=' },
]
