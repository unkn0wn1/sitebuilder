# 0020: Declarative plugins

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

[ADR 0006](0006-site-layer.md) keeps organisation-specific code in a `site/` layer that is compiled with the app. Nothing in that layer is installed from the builder. The vision used to rule out a plugin marketplace, so every new block was a code review.

Admins still need a checked section they can add without a rebuild. An agent may draft that package. A public marketplace is still out of scope.

## Decision

- A plugin is declarative. It is a manifest, logic-less templates, CSS and static assets. The server does not run package code. Version 1 does not add visitor JavaScript. There is no in-app code editor.
- An admin installs a package from Settings, Plugins. There is no public marketplace. The package is a gzip ustar archive (`.tar.gz`).
- Trust is one of two labels, shown wherever a plugin is listed. **Official** means the detached signature verifies against a built-in public key. **Self-installed** means there is no signature, or the key id is not in that list. A signature that names a known key and does not verify is rejected. A file that is not a sitebuilder plugin signature is rejected. It does not count as Self-installed.
- The signature follows minisign's layout, but it is not stock minisign. `minisign -V` will not verify these files, because the signature covers the content hash, not the archive bytes.
- The content hash is SHA-256 of the sorted file records. For each file the record is the UTF-8 path, one NUL byte, then the raw 32-byte SHA-256 of the file bytes. Records are sorted by the raw path bytes, unsigned, one byte at a time, then concatenated with no extra separator. Directories are not hashed. Tar order, ustar mtime and gzip headers are not inputs. The hex form is lowercase and 64 characters. The signature signs the raw 32-byte hash, not the hex.
- The signature file is UTF-8, LF, four lines, and an optional trailing LF. The first line is `untrusted comment: sitebuilder plugin signature`. The second line is base64 of the two bytes `0x45 0x64`, then the 8-byte key id, then the 64-byte signature over the raw content hash. The key id is the first 8 bytes of SHA-256 of the raw 32-byte public key. The third line is `trusted comment: plugin=<id> version=<version> hash=<hex>`. The fourth line is base64 of a second signature over the first signature followed by the trusted comment text. Both signatures are Ed25519.
- Any plugin that needs an external origin needs the owner (`isOperator`) before it is enabled. That covers CSP image, frame, connect and font origins, and a head link that is not a site path. A plain admin can install a plugin that needs no origins. The manifest still has a script-origin list so a later version can allow scripts without a new shape. Version 1 refuses a non-empty script list: plugins cannot add scripts.
- Official public keys live in `shared/plugins/keys.ts` as `{ id, publicKey }`, where `publicKey` is the raw 32 bytes in standard base64. The list starts empty. The first official plugins add one public key. No private key is stored in this repository. The keygen script writes a PKCS8 PEM with mode `0o600`. The path is `SITEBUILDER_PLUGIN_SIGNING_KEY`, or `~/.config/sitebuilder/official-signing.key` when that is unset. The script refuses a path inside the repo and refuses to overwrite an existing file. It prints the public key and the key id. It never prints the private key.
- Packages are stored in SQLite, not on a volume. A database backup then includes the files, and the stored bytes are what the content hash checks. The tables are `plugins`, `plugin_files`, `plugin_settings` and `plugin_proposals`.
- An agent may propose a package. Installing or enabling it always needs a person. Rules and always-allow cannot install a plugin. `plugin_proposals` holds that review. A proposal is not a plugin row.
- A later repository can publish an index without changing the package format. The index is JSON. `schema` is `1`, and `plugins` is a list of objects with `id`, `version`, `contentHash`, `archive`, `signature`, `keyId` and `core`. This record does not build a client for that index. The index itself is not signed. Trusting it needs a signature story: sign the index with an official key, or trust it only over HTTPS together with each package signature.

```json
{
  "schema": 1,
  "plugins": [
    {
      "id": "match-thermometer",
      "version": "1.0.0",
      "contentHash": "<64 hex>",
      "archive": "match-thermometer-1.0.0.tar.gz",
      "signature": "match-thermometer-1.0.0.tar.gz.sig",
      "keyId": "<16 hex>",
      "core": ">=0.1.0 <0.2.0"
    }
  ]
}
```

- The theme bundle id stays `theme-default-5`. A release manifest may include `pluginBundleId`. If that field is missing, the release had no plugins. It is not compared with older `bundleId` values such as `dev`.

## Not in v1

Phase 6 is design only. It is not built on this branch.

- A public sitebuilder home site and a full docs library (the Part 4 VitePress site, still unbuilt).
- A plugin repository: signed `.tar.gz` packages plus the index JSON above. Clients verify each package. The index itself needs a signature story before it is trusted.
- A public admin demo. An in-app "Reset demo" button anyone can press. It restores the demo database and the media folder from a saved snapshot. It does not rebuild a VM.
- An hourly job repeats that restore, in case nobody presses the button.
- One visitor's reset must not wipe another visitor mid-edit. Prefer a per-visitor sandbox site (a copy of the snapshot keyed by a demo session) or, if that is too heavy, a cooldown and a warning that reset replaces the shared demo. Record the choice when Phase 6 is built. The plan for now is: design the sandbox first, and keep the hourly restore as the backstop for the shared snapshot.
- Demo mode locks uploads that are not part of the snapshot story, locks outbound mail, and locks AI calls that spend a key or leave the machine. The gateway stays off.

## Consequences

- A build from before plugins rejects a stored section whose type contains a slash, because that build's registry throws on an unknown type. This build keeps the section when the plugin is missing, and the published page leaves that section out.
- Code blocks stay on the `site/` layer in [ADR 0006](0006-site-layer.md). That layer is not replaced, and those code blocks are still not built.
- A package that fails the check is not installed. A stored plugin that no longer checks out is disabled on boot with a short message. The rest of the app still starts.
- Origins from a plugin are added to a page only when that page uses the plugin's block. Pages that use no plugin block stay as they were.
