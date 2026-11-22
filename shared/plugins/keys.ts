// Official plugin signing keys. Public keys only. 3f adds the first one.
// Do not put a private key, a seed, or a PEM block in this module.
import type { OfficialKey } from './signature'

/**
 * Built-in keys that make a package Official.
 * An empty list is valid: every other package is Self-installed until a public key is added.
 */
export const OFFICIAL_KEYS: readonly OfficialKey[] = []
