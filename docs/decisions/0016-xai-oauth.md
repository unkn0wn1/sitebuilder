# 0016: Optional Sign in with xAI (device code)

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The assistant already talks to xAI's OpenAI-compatible API with a pasted API key (`ai_api_key`). Spencer wants to sign in with his SuperGrok or X Premium+ subscription instead of pasting a key. xAI runs an OIDC server at `https://auth.x.ai` (Authorization Code + PKCE S256, and device code RFC 8628). The issued access token is a bearer token for `https://api.x.ai/v1`, so this is an auth-header swap on the existing provider.

xAI has no public developer console for registering a third-party OAuth client. Community tools (Hermes Agent, CraftBot, Grok CLI plugins) reuse a public client id originally registered for Grok CLI / Hermes, whose only allowlisted redirect is `http://127.0.0.1:56121/callback`. That loopback callback cannot work for a hosted admin behind Cloudflare. Device code does not need a redirect URI.

This must not be on in the default open-source install.

## Decision

- **Off by default.** The feature is in the main repo but is inert unless `SITEBUILDER_ENABLE_XAI_OAUTH=1`. When the flag is off, the Settings UI hides the option and the routes return 404.
- **Device code, not auth-code + PKCE**, for a hosted admin. Settings > AI shows the user code and verification link, then polls until xAI approves, the code expires, or the admin cancels. Endpoints come from `https://auth.x.ai/.well-known/openid-configuration` at runtime (the discovery URL can be overridden in tests). They are not hardcoded.
- **Client id is configurable** via `SITEBUILDER_XAI_OAUTH_CLIENT_ID`. Until xAI offers app registration for a Sitebuilder client, the fallback is the public Grok CLI / Hermes client `b1a00492-073a-47ea-816f-4c329264a828`. That is not a Sitebuilder-registered app; it is documented and overridable, not silently treated as ours.
- **Tokens are stored encrypted** in the existing secrets table as `xai_oauth`, written only by the OAuth module, never by `PUT /settings/secrets`, and never returned by the API or written to logs. Access tokens are refreshed automatically. Disconnect revokes the refresh token when xAI exposes a revocation endpoint, then deletes the local secret.
- **The existing BYOK provider and cost caps are unchanged.** When the provider is xAI and a sign-in is connected, the same OpenAI-compatible client is used with the OAuth access token instead of the API key. Caps still apply. If xAI returns 403 for the subscription tier, the UI and the provider surface a clear error and leave the API key option in place.

## Consequences

- Operators who want the option turn the flag on in the install environment (the demo does). Everyone else sees only the API key field.
- If xAI later lets us register our own client, set `SITEBUILDER_XAI_OAUTH_CLIENT_ID` and keep the same device-code flow.
- A pending device login lives in the builder process's memory. If the container restarts mid-sign-in, the admin starts again. That matches the single-container install (ADR 0007).
- Some SuperGrok tiers have been seen to fail OAuth inference with HTTP 403 even after a successful sign-in. The fallback is a paid API key.
