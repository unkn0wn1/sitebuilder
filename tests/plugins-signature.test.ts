import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentHash } from '../shared/plugins/hash'
import { OFFICIAL_KEYS } from '../shared/plugins/keys'
import {
  SIGNATURE_MISMATCH,
  SIGNATURE_UNREADABLE,
  decideTrust,
  officialKeyId,
  rawEd25519PublicKey,
  signPluginSignature,
  type OfficialKey,
} from '../shared/plugins/signature'

function keypair(): { privateKey: KeyObject; raw: Buffer; listed: OfficialKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawEd25519PublicKey(publicKey)
  return { privateKey, raw, listed: { id: officialKeyId(raw), publicKey: raw.toString('base64') } }
}

function flipPayload(text: string): string {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  const payloadLine = lines[1]
  if (!payloadLine) throw new Error('missing payload')
  const payload = Buffer.from(payloadLine, 'base64')
  payload[10] = (payload[10] ?? 0) ^ 0x01
  lines[1] = payload.toString('base64')
  return `${lines.join('\n')}\n`
}

const hash = contentHash([{ path: 'plugin.json', bytes: Buffer.from('{}') }])

describe('plugin signatures', () => {
  it('keeps the official key list to public keys only', () => {
    const source = readFileSync(new URL('../shared/plugins/keys.ts', import.meta.url), 'utf8')
    expect(source.includes('PRIVATE')).toBe(false)
    expect(source.includes('BEGIN')).toBe(false)
    for (const key of OFFICIAL_KEYS) {
      const raw = Buffer.from(key.publicKey, 'base64')
      expect(raw).toHaveLength(32)
      expect(officialKeyId(raw)).toBe(key.id)
    }
  })

  it('accepts a good official key and rejects a bad signature for that key', () => {
    const key = keypair()
    const signed = signPluginSignature({
      privateKey: key.privateKey,
      publicKey: key.raw,
      contentHash: hash.raw,
      pluginId: 'hello-note',
      version: '1.0.0',
    })
    expect(decideTrust({ signature: signed, contentHash: hash.raw, pluginId: 'hello-note', version: '1.0.0', keys: [key.listed] })).toEqual({
      ok: true,
      trust: 'official',
      keyId: key.listed.id,
    })
    const flipped = decideTrust({
      signature: flipPayload(signed),
      contentHash: hash.raw,
      pluginId: 'hello-note',
      version: '1.0.0',
      keys: [key.listed],
    })
    expect(flipped).toEqual({ ok: false, message: SIGNATURE_MISMATCH })
    const comment = signed.replace(/hash=[0-9a-f]{64}/, `hash=${'ab'.repeat(32)}`)
    expect(comment).not.toBe(signed)
    expect(decideTrust({ signature: comment, contentHash: hash.raw, pluginId: 'hello-note', version: '1.0.0', keys: [key.listed] })).toEqual({
      ok: false,
      message: SIGNATURE_MISMATCH,
    })
  })

  it('treats an unknown key as self-installed, even when the signature bits are wrong', () => {
    const known = keypair()
    const other = keypair()
    const signed = signPluginSignature({
      privateKey: other.privateKey,
      publicKey: other.raw,
      contentHash: hash.raw,
      pluginId: 'hello-note',
      version: '1.0.0',
    })
    const input = { contentHash: hash.raw, pluginId: 'hello-note', version: '1.0.0', keys: [known.listed] }
    expect(decideTrust({ ...input, signature: signed })).toEqual({ ok: true, trust: 'self', keyId: other.listed.id })
    expect(decideTrust({ ...input, signature: flipPayload(signed) })).toEqual({ ok: true, trust: 'self', keyId: other.listed.id })
    const comment = signed.replace(/hash=[0-9a-f]{64}/, `hash=${'cd'.repeat(32)}`)
    expect(decideTrust({ ...input, signature: comment })).toEqual({ ok: true, trust: 'self', keyId: other.listed.id })
  })

  it('rejects an unparseable file and treats a missing file as self-installed', () => {
    const key = keypair()
    const keys = [key.listed]
    expect(decideTrust({ signature: null, contentHash: hash.raw, pluginId: 'hello-note', version: '1.0.0', keys })).toEqual({
      ok: true,
      trust: 'self',
      keyId: null,
    })
    for (const signature of ['this is not a signature', 'untrusted comment: sitebuilder plugin signature\r\nmore', '']) {
      expect(decideTrust({ signature, contentHash: hash.raw, pluginId: 'hello-note', version: '1.0.0', keys })).toEqual({
        ok: false,
        message: SIGNATURE_UNREADABLE,
      })
    }
    expect(SIGNATURE_MISMATCH).toBe('The signature does not match an official key.')
    expect(SIGNATURE_UNREADABLE).toBe('The signature file is not a sitebuilder plugin signature.')
  })
})
