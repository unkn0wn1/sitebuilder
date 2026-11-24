// Delete expired demo sandboxes. Refuses to delete anything if the golden checksum does not match.
import { runDemoSweep } from '../server/services/demo-sandbox'

try {
  const { deleted } = runDemoSweep()
  console.log(JSON.stringify({ level: 'info', msg: 'demo sweep', deleted: deleted.length }))
} catch (error) {
  console.error(JSON.stringify({ level: 'error', msg: 'demo sweep', error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
}
