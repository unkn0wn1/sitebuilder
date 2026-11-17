import { z } from 'zod'
import { ALT_TEXT_BATCH_LIMIT, suggestAltForMediaBatch } from '../../../services/alt-text'
import { defineApi, parseBody, requireActor } from '../../../utils/api'
import { mediaDir } from '../../../utils/state'

const bodySchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).max(ALT_TEXT_BATCH_LIMIT).optional(),
    limit: z.number().int().min(1).max(ALT_TEXT_BATCH_LIMIT).optional(),
  })
  .strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const body = await parseBody(event, bodySchema)
  return suggestAltForMediaBatch(ctx, actor, { mediaDir: mediaDir(), ids: body.ids, limit: body.limit })
})
