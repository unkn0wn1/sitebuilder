# Security

**Draft, v1 baseline.** How the builder and the public site are protected. Principle 3 in [01-principles.md](01-principles.md) ("guardrails by design, not by policy") applies throughout: prefer designs that make a mistake impossible over rules people must remember.

## Threats we design for

- Someone guessing or stealing a staff login.
- Script injected into the public site (through rich text, embeds, tracking or a compromised account).
- Someone reaching the origin server directly, around Cloudflare.
- The AI being talked, or tricked by content it reads, into doing something outside its task.
- The builder's server being used to reach internal addresses (SSRF).
- Secrets (AI key, Cloudflare token, Google OAuth client secret and mail tokens) leaking.
- Losing data (see [16-operations.md](16-operations.md#backups-and-restore)).

## The builder

- **Cloudflare Access in front** of the builder hostname, required in production ([ADR 0007](decisions/0007-single-site-install.md)). The builder also checks the Access token (the `Cf-Access-Jwt-Assertion` header: signature against the team's published keys, issuer, audience and expiry) on every request except the health check, and refuses to start in production without the team domain and audience set.
- **Own login as a second layer:** email and password, hashed with scrypt (Node's built-in crypto, no native add-on). Minimum 12 characters, checked against a short list of common passwords.
- **Sessions:** random 32-byte token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Only a SHA-256 hash is stored. 12-hour idle timeout, 14-day maximum. Password change or reset ends all other sessions.
- **CSRF:** `SameSite=Strict` cookies plus an `Origin` check on every request that changes something.
- **Rate limits:** sign-in and password reset by IP and by email; AI messages per user.
- **Permissions** are checked in the API for every route and every AI tool call. Hidden buttons are never the protection.
- **Builder Content Security Policy:** `default-src 'self'`, no inline scripts, `frame-src` limited to the preview origin, `connect-src 'self'`.
- **Audit log** of sign-ins, role changes, approvals, publishes, rollbacks, settings and secret changes, and every AI tool call.

## The public site

- **No HTML in content.** Rich text is structured JSON rendered by our code ([ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md)). Links are limited to safe schemes.
- **SVG** uploads only for logos and icons, sanitised (scripts, event handlers, external references and `foreignObject` removed), and served with `Content-Type: image/svg+xml` from the media path, never inlined unsanitised.
- **Content Security Policy per page**, generated at render time from what the page uses: our own assets, plus the domains of the embeds on that page (for example Virtuous only on pages with a donation form) and the enabled tracking integrations ([ADR 0011](decisions/0011-named-tracking-integrations.md)). Sent as a `<meta http-equiv>` tag (static pages) and, for the shared parts, as an nginx header.
- **Embeds** only from the admin allow-list. Iframes get `sandbox` with the minimum allowances the provider needs, `referrerpolicy="strict-origin-when-cross-origin"` and `loading="lazy"`.
- **Other headers from nginx:** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone and geolocation off.

## The origin server

- **Only Cloudflare may reach nginx.** Firewall the web ports to Cloudflare's published IP ranges, and turn on **Authenticated Origin Pulls** so nginx rejects requests without Cloudflare's client certificate. Visitors cannot go around the cache or the protection.
- SSH by key only, automatic security updates, nothing else listening.
- **Privilege separation:** the builder runs as its own user in its own container. It writes release folders, including a generated `redirects.map`, and switches the `current` symlink. It cannot change nginx's main config or run commands in the nginx container. nginx includes `current/redirects.map`, and a small fixed watcher in the nginx container runs `nginx -s reload` when `current` changes. The builder never has root.

## Secrets

- Integration secrets (AI key, Cloudflare token, Google OAuth client secret, and Gmail OAuth tokens) are stored in the `secrets` table, **encrypted with AES-256-GCM**. Gmail refresh and access tokens are written only by the OAuth callback, never by the secrets API, and are never returned.
- The encryption key is **`SITEBUILDER_SECRET_KEY`**, set in the server's environment file (outside the database and outside the repo), created by the installer.
- **Backups:** the database backup and the key are stored **separately**. Restoring needs both. The restore guide says so in bold. If the key is lost, the secrets must be re-entered (content is not affected).
- Secrets are write-only in the API and the GUI. They are never sent to the browser and never shown in logs.
- **Cloudflare token scope:** Zone, Cache Purge, for the one zone only. Nothing else.
- **AI key:** sent only to the configured provider's endpoint.
- **Google OAuth:** the client secret and Gmail tokens never leave the server. The access token is sent only to Google, to send mail or refresh. The Gmail scopes are send-only plus the account email.

## The AI

The remit and task scoping are in [12-ai-harness.md](12-ai-harness.md). The security side:

- **Task-scoped tools** limit the blast radius: a page edit session can only change that one page's draft, and nothing it does goes live without a person approving it.
- **No secrets in context.** The model never sees keys, tokens, emails of other users or the audit log.
- **Untrusted content is labelled.** Existing page content, uploaded file text and fetched pages are passed inside clearly marked data sections, with an instruction that they are data. This reduces, but does not remove, prompt injection. The tool scoping is what makes it safe.
- **`remember` needs a click.** The agent can only propose a memory entry. A person must accept it, so injected text cannot quietly persist.

### Reference URL fetch (when enabled)

- The fetch runs in a separate, locked-down step, not inside the agent loop.
- **SSRF guard:** only `http` and `https` on ports 80 and 443; the hostname is resolved and **every address is checked** against private, loopback, link-local, carrier-grade NAT, multicast and cloud metadata ranges (IPv4 and IPv6); the check repeats for **every redirect** (maximum 3); no cookies or credentials; 10-second timeout; 5 MB limit; HTML, CSS and JS only.
- The session that studies a reference site gets **no write tools at all**. It can only describe what it found. Building the new section variant is a separate step that produces a code change for developer review ([ADR 0006](decisions/0006-site-layer.md)).

## Privacy

- Draft content is sent to the chosen AI provider. The Settings > AI screen says which provider and links to its data policy.
- The AI panel shows a short hint: "Don't paste personal details such as donor names."
- AI logs keep tool calls in full and message text for 90 days, then summaries only.
- Media uploads have EXIF and GPS data stripped ([05-image-pipeline.md](05-image-pipeline.md)).
