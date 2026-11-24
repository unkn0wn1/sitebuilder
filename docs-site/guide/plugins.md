---
title: Plugins
---

# Plugins

There is no open plugin marketplace. The in-app catalogue is a small set of official packages, each signed by the Skewstone maintainers. Nothing third-party, and nothing is installed unless an admin chooses it.

A plugin is a declarative package: a manifest, logic-less templates, CSS and static assets. The server does not run package code. Version 1 does not add visitor JavaScript. [ADR 0020](https://github.com/unkn0wn1/sitebuilder/blob/main/docs/decisions/0020-plugins.md) is the decision. This page is how to write, pack and sign one.

The product name is Skewstone. The repository, the package format and the signature comment stay `sitebuilder`.

## Manifest

`plugin.json` is the manifest. The id is a short name: a letter, then lowercase letters, numbers or hyphens. `version` is `1.2.3`. `sitebuilder` is a core range such as `>=0.1.0 <0.2.0`. `permissions` lists `blocks`, and `head` or `settings` only when the package uses those. `csp` lists https origins for images, frames, connections and fonts. Each list can be empty. A non-empty `script` list is refused.

A block has a capitalised `type`, a version `v` starting at 1, a label, a category, a props schema, a template path, an example that matches the props, and an optional CSS path. `money: true` marks a block that shows an amount, so the agent floor treats it like a core money section. `agent.writable` and a short `describe` (200 characters at most) say whether an agent may draft the block.

The stored type is `plugin-id/BlockType`. The official gift package is `gift-tiers` with block type `Tiers`, stored as `gift-tiers/Tiers`. That is a new plugin. It is not the core Gift picker.

## Templates

Templates are logic-less. Text is escaped. HTML and a safe set of SVG tags are allowed. `style`, `href`, `src` and event handlers are not. Links, images and rich text go through helpers. A local id is prefixed per section.

Computed fields are a closed set: `percent`, `svg-scale`, `money`, `add`, `subtract`, `min` and `match-fill`. `match-fill` takes the raised amount, the matched amount, the goal, and the top and bottom of the tube. Money amounts in these packages are strings, which both `money` and `match-fill` accept.

## CSS

Plugin CSS is checked by the same sanitiser as site CSS. No `@import`, no `url(` except a site media path or a small data image, no `expression`, no `javascript:`. Class and element selectors are scoped to the block when the page is drawn. The page keeps an 8,192 byte reserve for plugin CSS. See [11-theming.md](https://github.com/unkn0wn1/sitebuilder/blob/main/docs/11-theming.md).

## Migrations

A migration is a list of `rename`, `delete` and `set` steps, keyed by block type and old version. It is required only when `v` is greater than 1. The official packages are version 1 and have none. A downgrade is refused.

## Pack and sign

From the repository root:

```
npx tsx scripts/plugin-pack.ts plugins/official/match-thermometer --out match-thermometer-1.0.0.tar.gz
SITEBUILDER_PLUGIN_SIGNING_KEY=/path/outside/the/repo npx tsx scripts/plugin-sign.ts match-thermometer-1.0.0.tar.gz
```

Pack reads `plugin.json`, `.html`, `.css`, `.svg`, `.png`, `.webp`, `.avif` and `.gif`. It prints the content hash and the archive path. It does not sign.

The content hash is SHA-256 of the sorted file records. Tar order, mtime and gzip headers are not inputs. The signature covers the raw 32-byte hash, not the archive bytes, so `minisign -V` will not verify these files.

Sign reads the key from `SITEBUILDER_PLUGIN_SIGNING_KEY` only. It writes a `.sig` file, mode `0o644`, and prints the id, version, hash and key id. It never prints the private key.

```
npx tsx scripts/plugin-keygen.ts
npx tsx scripts/plugin-keygen.ts --public
```

Keygen writes a PKCS8 PEM, mode `0o600`, at `SITEBUILDER_PLUGIN_SIGNING_KEY` or `~/.config/sitebuilder/official-signing.key`. It refuses a path inside this repository, including a symlink that lands inside it, and it refuses to overwrite. Stdout is two lines, `publicKey:` and `keyId:`. `--public` prints those two lines for an existing file and does not write.

## Trust

**Official** means the detached signature verifies against a built-in public key in `shared/plugins/keys.ts`. **Self-installed** means there is no signature, or the key id is not in that list. A signature that names a known key and does not verify is rejected. A file that is not a sitebuilder plugin signature is rejected. It does not count as Self-installed.

A package that needs an external origin stays off until an owner confirms it.

## Key rotation

Add the new public key beside the old one. Sign new packages, and the next index, with the new key. Remove the old public key only when nothing that should stay Official still verifies with it. The private key never goes in this repository, in CI, or on the demo install.

## Repository

`npm run plugin-repo-build` reads `plugins/official/*` and writes:

- `index.json` and `index.json.sig`
- `index.html`, a static page with no script
- `packages/<id>/<version>/<id>-<version>.tar.gz` and the same path with `.sig`

The index is canonical JSON: UTF-8, LF, two-space indent, plugins sorted by id then version, and one trailing newline. It is signed with the same four-line signature as a package. The trusted comment is `plugin=repository-index version=1.0.0 hash=<hex>`. The first line stays `untrusted comment: sitebuilder plugin signature`.

A client refuses an Official install when that signature is missing, unreadable, or not from a built-in key. An unknown key on the index is a refusal, not Self-installed. The archive's content hash must equal the index entry, and the signature's key id must equal the entry, before the normal install path runs.

The in-app catalogue is Settings, Plugins, under **Add from the Skewstone repository**.

## Environment

These are commented in `deploy/env.example`. Leave them unset on a production install unless a line says otherwise.

- `SITEBUILDER_PLUGIN_REPO_URL` is the catalogue base. The default is `https://plugins.skewstone.com`.
- `SITEBUILDER_PLUGIN_REPO_HTTP_HOST` allows `http` only for that host, and only when the host is loopback or private. A public host in the variable is ignored.
- `SITEBUILDER_PLUGIN_SIGNING_KEY` is for author machines only.
- `SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS` is for tests. It must never be set in production. When it is `1`, `SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS` may add up to three public keys. The flag off ignores that list even if it is set.
