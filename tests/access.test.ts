import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { accessConfigFromEnv, createAccessVerifier, normaliseTeamDomain } from '../server/services/access'

const config = { teamDomain: 'https://charity.cloudflareaccess.com', aud: 'aud-tag-123' }

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) }
}

function token(privateKey: CryptoKey, claims: { iss?: string; aud?: string; exp?: number; email?: string } = {}) {
  return new SignJWT({ email: claims.email ?? 'Asha@Example.org' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? config.teamDomain)
    .setAudience(claims.aud ?? config.aud)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 600)
    .sign(privateKey)
}

describe('Cloudflare Access verification', () => {
  it('accepts a valid token and rejects wrong audience, issuer, expiry, signature or none', async () => {
    const { privateKey, jwks } = await keys()
    const verify = createAccessVerifier(config, jwks)
    expect(await verify(await token(privateKey))).toEqual({ ok: true, email: 'asha@example.org' })
    expect((await verify(await token(privateKey, { aud: 'other' }))).ok).toBe(false)
    expect((await verify(await token(privateKey, { iss: 'https://evil.cloudflareaccess.com' }))).ok).toBe(false)
    expect((await verify(await token(privateKey, { exp: Math.floor(Date.now() / 1000) - 3600 }))).ok).toBe(false)
    const other = await keys()
    expect((await verify(await token(other.privateKey))).ok).toBe(false)
    expect(await verify(undefined)).toEqual({ ok: false, reason: 'missing' })
    expect((await verify('not.a.jwt')).ok).toBe(false)
  })

  it('reads config from the environment', () => {
    expect(accessConfigFromEnv({})).toBeNull()
    expect(accessConfigFromEnv({ SITEBUILDER_ACCESS_AUD: 'a', SITEBUILDER_ACCESS_TEAM_DOMAIN: 'charity' })).toEqual({ aud: 'a', teamDomain: 'https://charity.cloudflareaccess.com' })
    expect(() => accessConfigFromEnv({ SITEBUILDER_ACCESS_AUD: 'a' })).toThrow()
    expect(normaliseTeamDomain('https://Charity.cloudflareaccess.com/')).toBe('https://charity.cloudflareaccess.com')
    expect(() => normaliseTeamDomain('https://evil.example.com')).toThrow()
  })
})
