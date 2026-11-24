# Contributing

Skewstone is MIT licensed. Inbound equals outbound: contributions are MIT as well. See [LICENSE](LICENSE) and the [code of conduct](CODE_OF_CONDUCT.md).

The repository is still called `sitebuilder`.

## Setup

Needs Node 22 or newer.

```bash
npm install
npm run seed       # .data/sitebuilder.db, an admin, page types, and a sample page
npm run dev        # http://localhost:3000
```

`npm run seed` prints a one-off admin password unless you set `SEED_ADMIN_PASSWORD` (and optionally `SEED_ADMIN_EMAIL`). Change it after signing in.

## Gates

Run these before a pull request:

```bash
npm run typecheck
npm test
npm run test:api
SITEBUILDER_AGENT_GATEWAY=1 npx playwright test
npm --prefix docs-site run build
```

`npm test` includes `tests/sections-golden.test.ts`. Those fixtures must stay byte-identical. Do not regenerate them to hide a renderer change.

Playwright does not start a server. Its default `baseURL` is `http://127.0.0.1:3010`. Start the app yourself and set `BASE_URL` when it is on another port:

```bash
BASE_URL=http://127.0.0.1:3020 SITEBUILDER_AGENT_GATEWAY=1 npx playwright test
```

The usual sign-in for that suite is `admin@example.org` / `sb-demo-pass-17`, with `SEED_SAMPLE_PAGES=1` and the agent gateway on.

Secret scanning, from a checkout that has the tool:

```bash
gitleaks detect --source . --log-opts="origin/main..HEAD" --redact
gitleaks dir . --redact
```

## Commits and pull requests

Keep commits small and about one change. Open a pull request to `main`. Do not force-push `main`.

Locked decisions go in `docs/decisions/` as a new ADR, or as an amendment on the record they change. Do not quietly contradict an accepted ADR.

## Secrets

Do not put secrets in git, issues, or logs. That includes API keys, Cloudflare tokens, Access audience tags, tunnel credentials, `SITEBUILDER_SECRET_KEY`, and backup encryption keys.

The public demo password `skewstone-demo` is not a secret. It is printed on the marketing page on purpose. Do not treat it as a credential to hide, and do not reuse it anywhere else.

## Official plugins

Only maintainers sign official plugins. The private signing key is never committed and never placed on the public demo host. Contributors do not need it to open a pull request. The keygen script arrives with the plugins release. Do not invent a key or add one to this repo.
