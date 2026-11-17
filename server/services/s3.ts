// Minimal S3-compatible client (Put, Get, List, Delete) using AWS Signature V4 and fetch.
// Used for off-site backups (R2, B2, AWS S3). See docs/16-operations.md#backups-and-restore.
import { createHash, createHmac } from 'node:crypto'

export interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  prefix?: string
}

export interface S3Object {
  name: string
  size: number
  lastModified: Date
}

type FetchLike = typeof fetch
let s3Http: FetchLike = fetch

export function setS3Http(fn: FetchLike | null) {
  s3Http = fn ?? fetch
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = env.SITEBUILDER_BACKUP_S3_ENDPOINT?.trim()
  const bucket = env.SITEBUILDER_BACKUP_S3_BUCKET?.trim()
  const accessKeyId = env.SITEBUILDER_BACKUP_S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.SITEBUILDER_BACKUP_S3_SECRET_ACCESS_KEY?.trim()
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    endpoint: endpoint.replace(/\/$/, ''),
    bucket,
    region: env.SITEBUILDER_BACKUP_S3_REGION?.trim() || 'auto',
    accessKeyId,
    secretAccessKey,
    prefix: trimPrefix(env.SITEBUILDER_BACKUP_S3_PREFIX),
  }
}

function trimPrefix(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function objectKey(cfg: S3Config, name: string): string {
  return cfg.prefix ? `${cfg.prefix}/${name}` : name
}

function endpointUrl(cfg: S3Config, key = '', query = ''): URL {
  const url = new URL(cfg.endpoint)
  // Path-style: endpoint/bucket/key — works on R2, B2 and AWS when addressing a custom endpoint.
  const path = [url.pathname.replace(/\/$/, ''), cfg.bucket, key].filter(Boolean).join('/')
  url.pathname = `/${path}`
  if (query) url.search = query.startsWith('?') ? query : `?${query}`
  return url
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function amzDate(now: Date): { amz: string; day: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return { amz: iso, day: iso.slice(0, 8) }
}

async function signed(cfg: S3Config, method: string, url: URL, body: Buffer | undefined, now = new Date()): Promise<Response> {
  const { amz, day } = amzDate(now)
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0))
  const host = url.host
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const headers: Record<string, string> = {
    host,
    'x-amz-date': amz,
    'x-amz-content-sha256': payloadHash,
  }
  if (body) headers['content-length'] = String(body.length)
  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')
  const canonical = `${method}\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${day}/${cfg.region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonical)}`
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, day)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return s3Http(url, { method, headers, body: body ? new Uint8Array(body) : undefined })
}

export async function s3Put(cfg: S3Config, name: string, body: Buffer): Promise<void> {
  const url = endpointUrl(cfg, objectKey(cfg, name))
  const res = await signed(cfg, 'PUT', url, body)
  if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}

export async function s3Get(cfg: S3Config, name: string): Promise<Buffer> {
  const url = endpointUrl(cfg, objectKey(cfg, name))
  const res = await signed(cfg, 'GET', url, undefined)
  if (res.status === 404) throw new Error(`Backup ${name} was not found.`)
  if (!res.ok) throw new Error(`S3 download failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function s3Delete(cfg: S3Config, name: string): Promise<void> {
  const url = endpointUrl(cfg, objectKey(cfg, name))
  const res = await signed(cfg, 'DELETE', url, undefined)
  if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}

export async function s3List(cfg: S3Config): Promise<S3Object[]> {
  const prefix = cfg.prefix ? `${cfg.prefix}/` : ''
  const out: S3Object[] = []
  let token: string | undefined
  do {
    const params = new URLSearchParams({ 'list-type': '2' })
    if (prefix) params.set('prefix', prefix)
    if (token) params.set('continuation-token', token)
    const url = endpointUrl(cfg, '', params.toString())
    const res = await signed(cfg, 'GET', url, undefined)
    if (!res.ok) throw new Error(`S3 list failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    const xml = await res.text()
    for (const item of xml.split(/<Contents>/).slice(1)) {
      const key = textBetween(item, 'Key')
      const size = Number(textBetween(item, 'Size') ?? '0')
      const modified = textBetween(item, 'LastModified')
      if (!key) continue
      const name = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key
      out.push({ name, size, lastModified: modified ? new Date(modified) : new Date(0) })
    }
    const truncated = textBetween(xml, 'IsTruncated') === 'true'
    token = truncated ? textBetween(xml, 'NextContinuationToken') : undefined
  } while (token)
  return out
}

function textBetween(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match?.[1]
}
