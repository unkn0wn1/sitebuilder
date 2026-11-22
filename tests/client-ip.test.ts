import { createEvent } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { clientIp } from '../server/utils/client-ip'

function eventWith(headers: Record<string, string | undefined>, remoteAddress?: string) {
  const req = { headers, socket: { remoteAddress }, url: '/', method: 'POST' } as IncomingMessage
  return createEvent(req, {} as ServerResponse)
}

describe('clientIp', () => {
  it('uses the last X-Forwarded-For entry and ignores CF-Connecting-IP', () => {
    const event = eventWith(
      { 'x-forwarded-for': '1.1.1.1, 203.0.113.5', 'cf-connecting-ip': '9.9.9.9' },
      '10.0.0.1',
    )
    expect(clientIp(event)).toBe('203.0.113.5')
  })

  it('uses the socket address when X-Forwarded-For is absent or empty', () => {
    expect(clientIp(eventWith({ 'cf-connecting-ip': '9.9.9.9' }, '198.51.100.10'))).toBe('198.51.100.10')
    expect(clientIp(eventWith({ 'x-forwarded-for': '  ,  ' }, '192.0.2.1'))).toBe('192.0.2.1')
    expect(clientIp(eventWith({}))).toBeNull()
  })
})
