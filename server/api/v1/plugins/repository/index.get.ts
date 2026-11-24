import { z } from 'zod'
import { RepoError, listRepository } from '../../../../services/plugins/repository'
import { defineApi, parseQuery, requireCan } from '../../../../utils/api'
import { AppError } from '../../../../services/errors'

const query = z.object({ repoUrl: z.string().max(300).optional() })

export default defineApi(async (event) => {
  requireCan(event, 'settings.manage')
  const { repoUrl } = parseQuery(event, query)
  try {
    return await listRepository(repoUrl)
  } catch (error) {
    if (error instanceof RepoError) throw new AppError('validation_failed', error.message, [{ path: 'repository', message: error.message }])
    throw error
  }
})
