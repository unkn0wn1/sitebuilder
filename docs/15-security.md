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
- **Rate limits:** sign-in and password reset by IP and by email; AI messages per user. The IP is the last address in `X-Forwarded-For`. The shipped nginx sets that header to `$remote_addr` after Cloudflare real-ip, and does not append to a header the visitor sent.
- **Permissions** are checked in the API for every route and every AI tool call. Hidden buttons are never the protection.
- **Builder Content Security Policy:** production admin HTML pages get a per-request nonce and `default-src 'self'; script-src 'self' 'nonce-...'`, `connect-src 'self'`, `frame-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` (server/utils/builder-csp.ts). Demo mode also allows `https://challenges.cloudflare.com` on `script-src`, `frame-src`, and `connect-src` for the Turnstile widget on the login page. Preview frames are `sandbox="allow-same-origin"` with no `allow-scripts`, so nothing inside a preview runs or can call the admin API.
- **Audit log** of sign-ins, role changes, approvals, publishes, rollbacks, settings and secret changes, and every AI tool call.

## The public site

- **No HTML in content.** Rich text is structured JSON rendered by our code ([ADR 0010](decisions/0010-zod-versioned-blocks-structured-rich-text.md)). Links are limited to safe schemes.
- **Custom CSS** is the one place a person can write style rules ([ADR 0019](decisions/0019-custom-css.md)). The sanitiser rejects `</style>`, `@import`, `@charset`, `@namespace`, `@font-face`, `@page`, `@layer`, `@scope`, `@document`, `@nest`, any other at-rule, `expression()`, `javascript:` and `vbscript:` URLs, `-moz-binding`, and the `behavior` property. `url()`, `src()` and `image-set()` are rejected unless the address is a same-site media file (`/media/med_…`) or a `data:image` of png, webp, avif, gif or svg+xml. A raw value that contains a scheme or `//` is rejected the same way. A section selector that would style outside that section is rejected. The error names the line and column and does not echo the source. Allowed at-rules are `media`, `supports`, `container` and `keyframes`.
- **Prefix and the style hash.** Section CSS is prefixed at render with `[data-sb-css="…"]`, including keyframe names, so it stays inside that section. The stored text is the author's. The page's one `<style>` is the theme, the shell CSS, the site CSS, then each section. Its CSP `style-src` hash is the SHA-256 of that whole sheet, so a CSS edit changes the hash. Site CSS is not prefixed.
- **Custom CSS cannot load foreign fonts or images.** `font-src` stays `'self'` and `img-src` is not widened for CSS. `@font-face` and `@import` are rejected, and a `url()` may only point at this site's media or a data image. `position: fixed` is allowed and warned about: it can cover the page, and the prefix does not stop that.
- **SVG** uploads only for logos and icons, sanitised (scripts, event handlers, external references and `foreignObject` removed), and served with `Content-Type: image/svg+xml` from the media path, never inlined unsanitised.
- **Content Security Policy per page**, generated at render time from what the page uses: our own assets, plus the domains of the embeds on that page (for example Virtuous only on pages with a donation form) and the enabled tracking integrations ([ADR 0011](decisions/0011-named-tracking-integrations.md)). Sent as a `<meta http-equiv>` tag (static pages) and, for the shared parts, as an nginx header.
- **Embeds** only from the admin allow-list. Iframes get `sandbox` with the minimum allowances the provider needs, `referrerpolicy="strict-origin-when-cross-origin"` and `loading="lazy"`.
- **Other headers from nginx:** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone and geolocation off.

## The origin server

- **Only Cloudflare should reach nginx.** Firewall the host's ports 80 and 443 to Cloudflare's published IP ranges. The shipped public and builder servers listen on port 80. They do not terminate TLS, do not check a client certificate, and have no IP allow list. Authenticated Origin Pulls need TLS on the origin, which this config does not provide.
- **Client address:** the builder server includes `deploy/cloudflare-real-ip.conf` (ranges fetched from cloudflare.com/ips-v4 and ips-v6 on 22 Nov 2026) and `real_ip_header CF-Connecting-IP`, so `$remote_addr` is the visitor when the connection comes from Cloudflare. Both builder proxy locations then overwrite `X-Forwarded-For` with `$remote_addr` and clear `CF-Connecting-IP`. The app uses the last `X-Forwarded-For` entry and never reads `CF-Connecting-IP`. Anyone who runs without that nginx must overwrite `X-Forwarded-For` the same way. Appending, or trusting `CF-Connecting-IP` in the app, is not what this build does.
- SSH by key only, automatic security updates, nothing else listening.
- **Privilege separation:** the builder runs as its own user in its own container. It writes release folders, including a generated `redirects.map`, and switches the `current` symlink. It cannot change nginx's main config or run commands in the nginx container. nginx includes the live release's maps, and a small fixed watcher in the nginx container runs `nginx -t` and then `nginx -s reload` when `current` changes or when `redirects.map`, `redirect-status.map`, `cache-tags.map`, or `csp.map` changes. A failed test or reload is logged, and the config is left as it was. The builder never has root.

## Secrets

- Integration secrets (AI key, Cloudflare token, Google OAuth client secret, and Gmail OAuth tokens) are stored in the `secrets` table, **encrypted with AES-256-GCM**. Gmail refresh and access tokens are written only by the OAuth callback, never by the secrets API, and are never returned.
- The encryption key is **`SITEBUILDER_SECRET_KEY`**, set in the server's environment file (outside the database and outside the repo), created by the installer.
- **Backups:** the database backup and the key are stored **separately**. Restoring needs both. The restore guide says so in bold. If the key is lost, the secrets must be re-entered (content is not affected).
- Secrets are write-only in the API and the GUI. They are never sent to the browser and never shown in logs.
- **Cloudflare token scope:** Zone, Cache Purge, for the one zone only. Nothing else.
- **AI key:** sent only to the configured provider's endpoint.
- **Google OAuth:** the client secret and Gmail tokens never leave the server. The access token is sent only to Google, to send mail or refresh. The Gmail scopes are send-only plus the account email. The OAuth `state` is signed, expires in 10 minutes, and includes a one-time nonce that is stored and consumed so it cannot be replayed.

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
