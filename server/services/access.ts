// Cloudflare Access check inside the app (defence in depth behind the edge). ADR 0007, docs/15-security.md.
// Access adds a signed JWT in the Cf-Access-Jwt-Assertion header; we check signature, issuer, audience and expiry.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface AccessConfig {
  /** https://<team>.cloudflareaccess.com */
  teamDomain: string
  /** The Access application's audience (AUD) tag. */
  aud: string
}

export type AccessResult = { ok: true; email: string | null } | { ok: false; reason: string }

export function normaliseTeamDomain(value: string): string {
  const v = value.trim().replace(/\/+$/, '')
  if (/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v)) return v.toLowerCase()
  if (/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v)) return `https://${v.toLowerCase()}`
  if (/^[a-z0-9-]+$/i.test(v)) return `https://${v.toLowerCase()}.cloudflareaccess.com`
  throw new Error('SITEBUILDER_ACCESS_TEAM_DOMAIN should look like https://<team>.cloudflareaccess.com')
}

export function accessConfigFromEnv(env: Record<string, string | undefined>): AccessConfig | null {
  const aud = env.SITEBUILDER_ACCESS_AUD?.trim()
  const team = env.SITEBUILDER_ACCESS_TEAM_DOMAIN?.trim()
  if (!aud && !team) return null
  if (!aud || !team) throw new Error('Set both SITEBUILDER_ACCESS_AUD and SITEBUILDER_ACCESS_TEAM_DOMAIN, or neither.')
  return { teamDomain: normaliseTeamDomain(team), aud }
}

/** Build a verifier. Keys default to the team's published certs (cached and refreshed by jose). */
export function createAccessVerifier(config: AccessConfig, keys?: JWTVerifyGetKey) {
  const getKey = keys ?? createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 })
  return async (token: string | undefined | null): Promise<AccessResult> => {
    if (!token) return { ok: false, reason: 'missing' }
    try {
      const { payload } = await jwtVerify(token, getKey, { issuer: config.teamDomain, audience: config.aud, algorithms: ['RS256'], clockTolerance: 30 })
      return { ok: true, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? (error as { code?: string }).code ?? error.name : 'invalid' }
    }
  }
}
