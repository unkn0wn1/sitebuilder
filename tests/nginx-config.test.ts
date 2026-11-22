import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = join(root, 'deploy/nginx.conf.template')
const shippedPath = join(root, 'deploy/nginx.conf')
const realIpPath = join(root, 'deploy/cloudflare-real-ip.conf')
const template = readFileSync(templatePath, 'utf8')
const realIp = readFileSync(realIpPath, 'utf8')

const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']

function edgeCacheMapBody(): string {
  const match = template.match(/map \$status \$edge_cache_control \{([\s\S]*?)\n\}/)
  expect(match, 'edge cache map').toBeTruthy()
  return match![1]!
}

describe('nginx config', () => {
  it('keeps deploy/nginx.conf identical to the template', () => {
    expect(readFileSync(shippedPath, 'utf8')).toBe(template)
  })

  it('trusts Cloudflare real IP on the builder only, then overwrites X-Forwarded-For', () => {
    const publicBlock = template.slice(0, template.indexOf('# Builder'))
    const builderBlock = template.slice(template.indexOf('# Builder'))
    expect(publicBlock).not.toContain('cloudflare-real-ip')
    expect(publicBlock).not.toContain('X-Forwarded-For')
    expect(builderBlock).toContain('include /etc/nginx/cloudflare-real-ip.conf;')
    expect(builderBlock.match(/include \/etc\/nginx\/cloudflare-real-ip\.conf;/g)).toHaveLength(1)
    expect(builderBlock).not.toContain('$proxy_add_x_forwarded_for')
    expect(builderBlock.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)).toHaveLength(2)
    expect(builderBlock.match(/proxy_set_header CF-Connecting-IP "";/g)).toHaveLength(2)
    expect(realIp).toContain('22 Nov 2026')
    expect(realIp).toContain('ips-v4')
    expect(realIp).toContain('ips-v6')
    expect(realIp).toContain('real_ip_header CF-Connecting-IP;')
    for (const range of [...CLOUDFLARE_V4, ...CLOUDFLARE_V6]) expect(realIp).toContain(`set_real_ip_from ${range};`)
    const compose = readFileSync(join(root, 'deploy/docker-compose.yml'), 'utf8')
    expect(compose).toContain('./cloudflare-real-ip.conf:/etc/nginx/cloudflare-real-ip.conf:ro')
  })

  it('gives embed.js, header.js and hero.js a short shell cache and no page CSP', () => {
    const block = (path: string) => {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = [...template.matchAll(new RegExp(`location = ${escaped} \\{([^}]*)\\}`, 'g'))]
      expect(matches, `location = ${path}`).toHaveLength(1)
      return matches[0]![1]!
    }
    for (const path of ['/embed.js', '/header.js', '/hero.js']) {
      const body = block(path)
      expect(body).toContain('add_header Cache-Tag "shell" always;')
      expect(body).toContain('add_header Cache-Control "public, max-age=300, s-maxage=3600" always;')
      expect(body).not.toContain('immutable')
      expect(body).not.toContain('Content-Security-Policy')
      expect(body).not.toContain('$edge_cache_control')
    }
    const analytics = block('/analytics.js')
    expect(analytics).toContain('add_header Cache-Tag "shell" always;')
    expect(analytics).toContain('add_header Cache-Control "public, max-age=0, s-maxage=3600" always;')
    expect(analytics).not.toContain('Content-Security-Policy')
  })

  it('sends nosniff and a referrer policy on the public site, including locations that replace headers', () => {
    const nosniff = 'add_header X-Content-Type-Options "nosniff" always;'
    const referrer = 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;'
    const pageCsp = 'add_header Content-Security-Policy $content_csp always;'
    const publicBlock = template.slice(0, template.indexOf('# Builder'))
    const builderBlock = template.slice(template.indexOf('# Builder'))
    const serverHeaders = publicBlock.slice(0, publicBlock.indexOf('\n  location '))
    expect(serverHeaders).toContain(pageCsp)
    expect(serverHeaders).toContain(nosniff)
    expect(serverHeaders).toContain(referrer)
    expect(template.match(/add_header Content-Security-Policy \$content_csp always;/g)).toHaveLength(1)

    const locationBody = (marker: string) => {
      const start = publicBlock.indexOf(marker)
      expect(start, marker).toBeGreaterThanOrEqual(0)
      expect(publicBlock.indexOf(marker, start + marker.length), marker).toBe(-1)
      const open = publicBlock.indexOf('{', start)
      let depth = 0
      for (let i = open; i < publicBlock.length; i++) {
        if (publicBlock[i] === '{') depth += 1
        else if (publicBlock[i] === '}') {
          depth -= 1
          if (depth === 0) return publicBlock.slice(open + 1, i)
        }
      }
      throw new Error(`unclosed ${marker}`)
    }
    const scripts = ['location = /embed.js {', 'location = /header.js {', 'location = /hero.js {', 'location = /analytics.js {']
    const media = ['location ~* ^/media/(.+\\.svg)$ {', 'location /media/ {']
    for (const marker of [...scripts, ...media]) {
      const body = locationBody(marker)
      expect(body, marker).toContain(nosniff)
      expect(body, marker).toContain(referrer)
      expect(body.split(nosniff).length - 1, marker).toBe(1)
      expect(body.split(referrer).length - 1, marker).toBe(1)
    }
    for (const marker of scripts) expect(locationBody(marker), marker).not.toContain('Content-Security-Policy')
    expect(locationBody('location /media/ {')).not.toContain('Content-Security-Policy')
    expect(locationBody('location ~* ^/media/(.+\\.svg)$ {')).toContain(
      'add_header Content-Security-Policy "default-src \'none\'; style-src \'unsafe-inline\'; sandbox" always;',
    )
    expect(locationBody('location / {')).not.toContain('add_header')
    expect(builderBlock).not.toContain('X-Content-Type-Options')
    expect(builderBlock).not.toContain('Referrer-Policy')
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
    const realIpCopy = join(dir, 'cloudflare-real-ip.conf')
    writeFileSync(realIpCopy, realIp)
    rendered = rendered.replaceAll('/etc/nginx/cloudflare-real-ip.conf', realIpCopy)
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
