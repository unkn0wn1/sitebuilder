#!/usr/bin/env tsx
// Prepare a Docker Compose install directory. See deploy/install.sh and docs/16-operations.md#install.
import { defaultOptionsFromArgs, installInstructions, prepareInstallDir } from '../server/services/install'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: install.ts --dir /srv/sitebuilder [--origin https://builder.example.org] [--public-host example.org] [--builder-host builder.example.org] [--access-team https://team.cloudflareaccess.com] [--access-aud AUD] [--zone ZONE_ID] [--allow-no-access] [--force]`)
  process.exit(0)
}
const prepared = prepareInstallDir(defaultOptionsFromArgs(args))
process.stdout.write(installInstructions(prepared))
if (prepared.created) {
  process.stderr.write('\nThe secret key is in the .env file. Copy it somewhere safe now.\n')
}
