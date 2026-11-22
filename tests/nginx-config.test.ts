import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = join(root, 'deploy/nginx.conf.template')
const shippedPath = join(root, 'deploy/nginx.conf')
const template = readFileSync(templatePath, 'utf8')

function edgeCacheMapBody(): string {
  const match = template.match(/map \$status \$edge_cache_control \{([\s\S]*?)\n\}/)
  expect(match, 'edge cache map').toBeTruthy()
  return match![1]!
}

describe('nginx config', () => {
  it('keeps deploy/nginx.conf identical to the template', () => {
    expect(readFileSync(shippedPath, 'utf8')).toBe(template)
  })

  it('does not give 404 or 410 an edge cache', () => {
    const body = edgeCacheMapBody()
    const line = (status: string) => body.split('\n').find((row) => new RegExp(`^\\s*${status}\\s`).test(row))
    const missing = line('404')
    const gone = line('410')
    const fallback = line('default')
    expect(missing).toContain('no-store')
    expect(missing).not.toContain('s-maxage')
    expect(gone).toContain('no-store')
    expect(gone).not.toContain('s-maxage')
    expect(fallback).toContain('s-maxage=86400')
    expect(template).toContain('add_header Cache-Control $edge_cache_control always;')
  })

  it.skipIf(!existsSync('/usr/sbin/nginx'))('nginx -t accepts the rendered template', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-nginx-h2-'))
    const logPath = join(dir, 'error.log')
    for (const name of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(join(dir, name))
    // nginx -t binds the listen ports. Keep that off port 80. The shipped file is unchanged.
    let rendered = template
      .replaceAll('${PUBLIC_HOST}', 'public.example')
      .replaceAll('${BUILDER_HOST}', 'builder.example')
      .replaceAll('listen 80;', 'listen 127.0.0.1:18080;')
      // The compose service name only resolves inside Docker.
      .replaceAll('http://builder:3000', 'http://127.0.0.1:3000')
    for (const name of ['redirects.map', 'redirect-status.map', 'cache-tags.map', 'csp.map']) {
      const path = join(dir, name)
      writeFileSync(path, '')
      rendered = rendered.replaceAll(`/var/lib/sitebuilder/site/current/${name}`, path)
    }
    const confPath = join(dir, 'nginx.conf')
    writeFileSync(
      confPath,
      `pid ${join(dir, 'nginx.pid')};
error_log ${logPath};
events {}
http {
  access_log off;
  client_body_temp_path ${join(dir, 'body')};
  proxy_temp_path ${join(dir, 'proxy')};
  fastcgi_temp_path ${join(dir, 'fastcgi')};
  uwsgi_temp_path ${join(dir, 'uwsgi')};
  scgi_temp_path ${join(dir, 'scgi')};
${rendered}
}
`,
    )
    execFileSync('/usr/sbin/nginx', ['-t', '-c', confPath, '-e', logPath], { stdio: 'pipe' })
  })
})
