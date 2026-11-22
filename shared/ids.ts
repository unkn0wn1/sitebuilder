// Prefixed, sortable ids, for example "pg_01JD3Q...". See docs/13-data-model.md#conventions.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32

export const ID_PREFIXES = {
  site: 'site',
  user: 'usr',
  session: 'ses',
  authToken: 'tok',
  page: 'pg',
  sitePart: 'sp',
  template: 'tpl',
  brand: 'brd',
  version: 'ver',
  op: 'op',
  review: 'rev',
  comment: 'cmt',
  media: 'med',
  crop: 'crp',
  embed: 'emb',
  redirect: 'rdr',
  release: 'rel',
  job: 'job',
  audit: 'aud',
  aiSession: 'ais',
  aiMessage: 'aim',
  memory: 'mem',
  notification: 'ntf',
  secret: 'sec',
  block: 'b',
  pageBrief: 'pbr',
  agentToken: 'agt',
  agentChange: 'chg',
} as const

export type IdKind = keyof typeof ID_PREFIXES

function encodeTime(ms: number): string {
  let out = ''
  let n = ms
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[n % 32] + out
    n = Math.floor(n / 32)
  }
  return out
}

function randomChars(count: number): string {
  const bytes = new Uint8Array(count)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}

/** A new id for the given kind. Block ids are short because they appear in page JSON. */
export function newId(kind: IdKind, now: number = Date.now()): string {
  const prefix = ID_PREFIXES[kind]
  if (kind === 'block') return `${prefix}_${randomChars(8).toLowerCase()}`
  return `${prefix}_${encodeTime(now)}${randomChars(16)}`
}

export function hasPrefix(id: string, kind: IdKind): boolean {
  return id.startsWith(`${ID_PREFIXES[kind]}_`)
}
