import { CronJob } from "cron";
import { getDb } from "../db/database";

const jobs = new Map<string, CronJob>();

export function startCronRunner() {
  const db = getDb();
  const schedules = db
    .prepare(
      'SELECT * FROM schedules WHERE status = "active" AND cron_expression IS NOT NULL',
    )
    .all() as any[];
  for (const s of schedules) {
    const job = new CronJob(s.cron_expression, () => {
      console.log(`[cron] Running: ${s.name}`);
    });
    jobs.set(s.id, job);
    job.start();
  }
}

export function stopAllCronJobs() {
  for (const [, j] of jobs) j.stop();
  jobs.clear();
}

export function addCronJob(id: string, cron: string, cb: () => void) {
  const j = new CronJob(cron, cb);
  jobs.set(id, j);
  j.start();
}

export function removeCronJob(id: string) {
  const j = jobs.get(id);
  if (j) {
    j.stop();
    jobs.delete(id);
  }
}
