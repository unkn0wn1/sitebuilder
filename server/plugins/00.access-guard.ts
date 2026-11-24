// Cloudflare Access is required in front of the builder in production (ADR 0007).
// The edge enforces Access, and server/middleware/00.access.ts checks the Access token on every request.
import { accessConfigFromEnv } from '../services/access'

export default defineNitroPlugin(() => {
  // Public demo (ADR 0007 amendment, 2026-11-24): this process does not use Cloudflare Access.
  if (process.env.SITEBUILDER_DEMO_MODE === '1') return
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.SITEBUILDER_ALLOW_NO_ACCESS === '1') {
    console.warn(JSON.stringify({ level: 'warn', msg: 'Running without Cloudflare Access (SITEBUILDER_ALLOW_NO_ACCESS=1). Do not expose this builder publicly.' }))
    return
  }
  if (!accessConfigFromEnv(process.env)) {
    throw new Error('Set SITEBUILDER_ACCESS_TEAM_DOMAIN and SITEBUILDER_ACCESS_AUD (Cloudflare Access), or SITEBUILDER_ALLOW_NO_ACCESS=1. See docs/decisions/0007-single-site-install.md.')
  }
})
