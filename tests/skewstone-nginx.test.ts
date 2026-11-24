import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nginx = readFileSync(join(root, 'deploy/skewstone/nginx.conf'), 'utf8')
const compose = readFileSync(join(root, 'deploy/skewstone/docker-compose.yml'), 'utf8')
const timer = readFileSync(join(root, 'deploy/skewstone/skewstone-demo-sweep.timer'), 'utf8')
const service = readFileSync(join(root, 'deploy/skewstone/skewstone-demo-sweep.service'), 'utf8')
const ingress = readFileSync(join(root, 'deploy/skewstone/cloudflared-ingress.example.yml'), 'utf8')

function section(name: string): string {
  const start = nginx.indexOf(`# --- ${name} ---`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const rest = nginx.slice(start + `# --- ${name} ---`.length)
  const next = rest.search(/\n# --- /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('skewstone nginx', () => {
  it('quotes every regex that contains braces, which nginx otherwise reads as a block', () => {
    const bad = nginx.split('\n').filter((line) => /^\s*~\S*\{/.test(line))
    expect(bad).toEqual([])
  })

  it('names the five hosts on five ports and does not mention a cache daemon', () => {
    expect(nginx).not.toContain('varnish')
    expect(section('marketing')).toContain('listen 8081 default_server;')
    expect(section('marketing')).toContain('server_name skewstone.com;')
    expect(section('docs')).toContain('listen 8082 default_server;')
    expect(section('docs')).toContain('server_name docs.skewstone.com;')
    expect(section('plugins')).toContain('listen 8083 default_server;')
    expect(section('plugins')).toContain('server_name plugins.skewstone.com;')
    expect(section('demo-site')).toContain('listen 8084 default_server;')
    expect(section('demo-site')).toContain('server_name demo.skewstone.com;')
    expect(section('demo-admin')).toContain('listen 8085 default_server;')
    expect(section('demo-admin')).toContain('server_name demo-admin.skewstone.com;')
  })

  it('sets the cache lifetimes from the plan', () => {
    expect(section('marketing')).toContain('Cache-Tag "www"')
    expect(section('marketing')).toContain('$skew_www_cache')
    expect(nginx).toContain('default "public, max-age=0, s-maxage=86400";')
    expect(section('docs')).toContain('Cache-Tag "docs"')
    expect(section('docs')).toContain('$skew_docs_html_cache')
    expect(section('docs')).toContain('location /assets/')
    expect(section('docs')).toContain('$skew_docs_asset_cache')
    expect(section('docs')).toContain('$skew_index_cache')
    expect(nginx).toContain('default "public, max-age=0, s-maxage=3600";')
    expect(nginx).toContain('default "public, max-age=31536000, immutable";')
    expect(nginx).toContain('default "public, max-age=0, s-maxage=60";')
    expect(section('plugins')).toContain('Cache-Tag "plugins-index"')
    expect(section('plugins')).toContain('location /packages/')
    expect(nginx).toContain('404 "no-store";')
    expect(nginx).toContain('410 "no-store";')
    expect(section('demo-admin')).toContain('private, no-store')
    expect(section('demo-admin')).toContain('public, max-age=31536000, immutable')
  })

  it('sends the robots header only on the demo site and the demo builder', () => {
    for (const name of ['marketing', 'docs', 'plugins']) expect(section(name)).not.toContain('X-Robots-Tag')
    expect(section('demo-site')).toContain('X-Robots-Tag "noindex, nofollow"')
    expect(section('demo-admin')).toContain('X-Robots-Tag "noindex, nofollow"')
    expect(section('demo-site')).toContain('return 200 "User-agent: *\\nDisallow: /\\n";')
    expect(section('demo-site')).not.toMatch(/^\s*alias\s/m)
    expect(section('marketing')).toContain('if ($host = www.skewstone.com)')
    expect(section('marketing')).toContain('return 301 https://skewstone.com$request_uri;')
  })

  it('trusts real-ip on the demo builder only, then overwrites the forwarding headers', () => {
    expect(section('marketing')).not.toContain('cloudflare-real-ip')
    expect(section('docs')).not.toContain('cloudflare-real-ip')
    expect(section('plugins')).not.toContain('cloudflare-real-ip')
    expect(section('demo-site')).not.toContain('cloudflare-real-ip')
    const admin = section('demo-admin')
    expect(admin).toContain('include /etc/nginx/cloudflare-real-ip.conf;')
    expect(admin.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)).toHaveLength(2)
    expect(admin.match(/proxy_set_header CF-Connecting-IP "";/g)).toHaveLength(2)
    expect(admin).toContain('proxy_set_header X-Forwarded-Proto $skew_forwarded_proto;')
    expect(admin).not.toContain('proxy_set_header X-Forwarded-Proto $scheme;')
    expect(nginx).toContain('map $http_x_forwarded_proto $skew_forwarded_proto')
  })

  it('keeps the demo compose, the sweep timer, and the tunnel example free of secrets', () => {
    expect(compose).toContain('SITEBUILDER_DEMO_MODE: "1"')
    expect(compose).toContain('SITEBUILDER_AGENT_GATEWAY: "0"')
    expect(compose).toContain('127.0.0.1:3000:3000')
    expect(compose).toContain('/var/lib/skewstone/demo:/var/lib/skewstone/demo')
    expect(compose).not.toContain('SITEBUILDER_CLOUDFLARE_TOKEN')
    expect(compose).not.toContain('CLOUDFLARE_ACCESS')
    expect(service).toContain('WorkingDirectory=/srv/skewstone')
    expect(service).toContain('docker compose exec -T builder npm run demo:sweep')
    expect(timer).toContain('OnUnitActiveSec=1h')
    expect(ingress).toContain('http://localhost:8081')
    expect(ingress).toContain('http://localhost:8085')
    expect(ingress).toContain('http_status:404')
    expect(ingress).not.toContain('tunnel:')
    expect(ingress).not.toContain('credentials')
  })
})
