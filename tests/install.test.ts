import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateSecretKey, installLayout, parseExistingSecret, prepareInstallDir, readComposeTemplate, renderEnvFile } from '../server/services/install'
import { secretKeyFromEnv } from '../server/services/auth'

describe('Compose install', () => {
  it('generates a 32-byte secret key and writes a 0600 env file with the volume layout', () => {
    const key = generateSecretKey()
    expect(secretKeyFromEnv(key).length).toBe(32)
    const root = mkdtempSync(join(tmpdir(), 'sitebuilder-install-'))
    const prepared = prepareInstallDir({
      dir: root,
      origin: 'https://builder.example.org',
      publicHost: 'example.org',
      builderHost: 'builder.example.org',
      accessTeamDomain: 'https://team.cloudflareaccess.com',
      accessAud: 'aud-123',
      cloudflareZoneId: 'zone-123',
    })
    expect(prepared.created).toBe(true)
    expect(existsSync(join(root, 'data'))).toBe(true)
    expect(existsSync(join(root, 'media', 'originals'))).toBe(true)
    expect(existsSync(join(root, 'site', 'releases'))).toBe(true)
    const env = readFileSync(prepared.envPath, 'utf8')
    expect(env).toContain(`SITEBUILDER_SECRET_KEY=${prepared.secretKey}`)
    expect(env).toContain('SITEBUILDER_ORIGIN=https://builder.example.org')
    expect(env).toContain('PUBLIC_HOST=example.org')
    expect(env).toContain('BUILDER_HOST=builder.example.org')
    expect(env).toContain(`SITEBUILDER_DATA_DIR=${join(root, 'data')}`)
    expect(statSync(prepared.envPath).mode & 0o777).toBe(0o600)
    const again = prepareInstallDir({ dir: root, origin: 'https://other.example.org', force: false })
    expect(again.created).toBe(false)
    expect(again.secretKey).toBe(prepared.secretKey)
    expect(readFileSync(prepared.envPath, 'utf8')).toContain('builder.example.org')
  })

  it('the compose file mounts data, media and site, and splits the public site from the builder', () => {
    const yaml = readComposeTemplate()
    expect(yaml).toContain('SITEBUILDER_DATA_DIR')
    expect(yaml).toContain('SITEBUILDER_MEDIA_HOST_DIR')
    expect(yaml).toContain('SITEBUILDER_SITE_DIR')
    expect(yaml).toContain('builder:')
    expect(yaml).toContain('nginx:')
    const layout = installLayout('/srv/sitebuilder')
    const env = renderEnvFile({ dir: '/srv/sitebuilder', origin: 'https://builder.example.org' }, 'key', layout)
    expect(parseExistingSecret(env)).toBe('key')
    expect(env).toContain('BUILDER_HOST=builder.example.org')
  })
})
