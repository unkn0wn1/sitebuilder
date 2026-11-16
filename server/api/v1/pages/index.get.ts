import { z } from 'zod'
import { WORKFLOW_STATES } from '../../../../shared/workflow'
import { listPages } from '../../../services/pages'
import { defineApi, paging, parseQuery, requireCan } from '../../../utils/api'

const schema = paging.extend({ search: z.string().max(200).optional(), state: z.enum(WORKFLOW_STATES).optional(), template: z.string().max(64).optional(), parentId: z.string().max(64).optional() })

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return listPages(ctx, parseQuery(event, schema))
})
