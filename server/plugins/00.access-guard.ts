// Cloudflare Access is required in front of the builder in production (ADR 0007).
// The edge enforces Access; verifying the Access JWT here as well is still to be built.
export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.SITEBUILDER_ALLOW_NO_ACCESS === '1') {
    console.warn(JSON.stringify({ level: 'warn', msg: 'Running without Cloudflare Access (SITEBUILDER_ALLOW_NO_ACCESS=1). Do not expose this builder publicly.' }))
    return
  }
  if (!process.env.SITEBUILDER_ACCESS_AUD) {
    throw new Error('Set SITEBUILDER_ACCESS_AUD (Cloudflare Access audience tag) or SITEBUILDER_ALLOW_NO_ACCESS=1. See docs/decisions/0007-single-site-install.md.')
  }
})
