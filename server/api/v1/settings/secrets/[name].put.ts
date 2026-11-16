import { z } from 'zod'
import { audit } from '../../../../services/audit'
import { secretKeyFromEnv, setSecret, SECRET_NAMES } from '../../../../services/auth'
import { AppError } from '../../../../services/errors'
import { defineApi, param, parseBody, requireCan } from '../../../../utils/api'

// Write-only: secrets are never returned by the API (docs/15-security.md#secrets).
export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'secrets.write')
  const name = z.enum(SECRET_NAMES).safeParse(param(event, 'name'))
  if (!name.success) throw new AppError('not_found', "That setting wasn't found.")
  const { value } = await parseBody(event, z.object({ value: z.string().min(1).max(4000) }))
  let key: Buffer
  try {
    key = secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
  } catch {
    throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY is not set on the server, so secrets cannot be stored yet.')
  }
  setSecret(ctx, key, name.data, value, actor.id)
  audit(ctx, actor, 'secret.updated', { type: 'secret', id: name.data })
  return { ok: true }
})
