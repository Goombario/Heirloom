import { query } from '@/lib/db/connection';
import { ANALYZE_SQL } from '@/lib/db/planner-stats';

/** Refresh the planner's statistics after a bulk write such as an import (#1268). */
export async function refreshPlannerStats(): Promise<void> {
  await query(ANALYZE_SQL);
}
