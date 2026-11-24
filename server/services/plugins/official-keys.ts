// Built-in official keys, plus a test-only extra list. Production never sets the flag.
import { OFFICIAL_KEYS } from '../../../shared/plugins/keys'
import { officialKeyId, type OfficialKey } from '../../../shared/plugins/signature'

const MAX_EXTRA = 3

function extraKeys(): OfficialKey[] {
  if (process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS !== '1') return []
  const raw = process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_EXTRA) return []
  const extra: OfficialKey[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return []
    const id = (item as { id?: unknown }).id
    const publicKey = (item as { publicKey?: unknown }).publicKey
    if (typeof id !== 'string' || typeof publicKey !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return []
    const bytes = Buffer.from(publicKey, 'base64')
    if (bytes.length !== 32 || bytes.toString('base64') !== publicKey || officialKeyId(bytes) !== id) return []
    extra.push({ id, publicKey })
  }
  return extra
}

/** Keys for decideTrust. The extra list is ignored unless the test flag is exactly "1". */
export function officialKeys(): readonly OfficialKey[] {
  const extra = extraKeys()
  if (!extra.length) return OFFICIAL_KEYS
  return [...OFFICIAL_KEYS, ...extra]
}
