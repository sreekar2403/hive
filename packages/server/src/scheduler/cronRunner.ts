import { CronJob, CronTime } from "cron";
import { getDb } from "../db/database";
import type { Schedule, ScheduleRun } from "../db/schedules";
import { recordScheduleRun } from "../db/schedules";
import { broadcast } from "../routes/events";
import { Orchestrator } from "../orchestrator";

const jobs = new Map<string, CronJob>();

/**
 * Executes a schedule's firing. There is no workflow executor wired up yet
 * (see CLAUDE.md's "Planning docs vs. reality") so this records a completed
 * run and notifies listeners rather than actually invoking `workflow_id`.
 * Both the cron ticker and the "Run now" API route call this so run history
 * is identical either way.
 */
export function fireSchedule(schedule: Schedule): ScheduleRun {
  const startedAt = Date.now();
  console.log(`[cron] Running: ${schedule.name}`);
  const run = recordScheduleRun({
    scheduleId: schedule.id,
    status: "success",
    startedAt,
    finishedAt: Date.now(),
  });
  broadcast("schedule:fired", { id: schedule.id, name: schedule.name, run });
  return run;
}

/**
 * Runs the Second Brain learning batch for all active orchestrators.
 * This is called on a timer to process accumulated observations and
 * generate soul.md suggestions.
 */
async function runLearningBatches(): Promise<void> {
  const orchestrator = Orchestrator.getActive();
  if (!orchestrator) return;

  const tasks = orchestrator.getAllTasks();
  const hasActiveTasks = tasks.some(
    (t) => t.status === "pending" || t.status === "running",
  );
  if (hasActiveTasks) {
    console.log("[cron] Skipping learning batch: tasks in progress");
    return;
  }

  try {
    // Run learning batch for each project. The argument is `force` — false
    // means the brain's own interval and busy-check still apply.
    const projects = getDb().prepare("SELECT id FROM projects").all() as {
      id: string;
    }[];
    for (const project of projects) {
      const brain = orchestrator.brainForProject(project.id);
      const queued = await brain.runLearningBatch(false);
      if (queued && queued.length > 0) {
        console.log(
          `[cron] Queued ${queued.length} soul.md suggestions for project ${project.id}`,
        );
      }
    }

    // Also run for global scope (no project)
    const globalBrain = orchestrator.brainForProject(null);
    const globalQueued = await globalBrain.runLearningBatch(false);
    if (globalQueued && globalQueued.length > 0) {
      console.log(
        `[cron] Queued ${globalQueued.length} global soul.md suggestions`,
      );
    }
  } catch (err) {
    console.error("[cron] Learning batch failed:", err);
  }
}

export function startCronRunner() {
  const db = getDb();
  const schedules = db
    .prepare(
      "SELECT * FROM schedules WHERE status = 'active' AND cron_expression IS NOT NULL",
    )
    .all() as Schedule[];
  for (const s of schedules) {
    const job = new CronJob(s.cron_expression as string, () => {
      fireSchedule(s);
    });
    jobs.set(s.id, job);
    job.start();
  }

  // Start the learning batch runner - runs every hour by default. CronJob
  // callbacks are sync, so the async body is fired off with its rejection
  // handled — an unhandled promise rejection here would take down the
  // process on a transient DB error.
  const learningJob = new CronJob("0 * * * *", () => {
    void runLearningBatches().catch((err) => {
      console.error("[cron] Learning batch crashed:", err);
    });
  });
  jobs.set("__learning_batch__", learningJob);
  learningJob.start();
}

/**
 * Registers, updates, or removes a schedule's cron job to match its current
 * row in the database. Call this any time a schedule is created, updated,
 * or deleted so the running cron jobs stay in sync with the table — the
 * jobs map is otherwise only ever populated once, at boot.
 */
export function syncCronJob(schedule: Schedule | null) {
  if (schedule) removeCronJob(schedule.id);
  if (!schedule) return;
  if (schedule.status !== "active" || !schedule.cron_expression) return;

  const job = new CronJob(schedule.cron_expression, () => {
    fireSchedule(schedule);
  });
  jobs.set(schedule.id, job);
  job.start();
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

/* ------------------------------------------------------------------ */
/* Cron expression helpers — used by the schedules API so the browser  */
/* never has to parse cron itself.                                     */
/* ------------------------------------------------------------------ */

/** Validates a cron expression without registering a job. */
export function validateCronExpression(expr: string): {
  valid: boolean;
  error?: string;
} {
  const result = CronTime.validateCronExpression(expr);
  return { valid: result.valid, error: result.error?.message };
}

/** Computes the next `count` fire times for a cron expression, in ms since epoch. */
export function getNextRunTimes(expr: string, count = 5): number[] {
  try {
    const time = new CronTime(expr);
    const dates = time.sendAt(count);
    return dates.map((d) => d.toMillis());
  } catch {
    return [];
  }
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function describeFrequency(minute: string, hour: string): string | null {
  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  const hourStep = /^\*\/(\d+)$/.exec(hour);

  if (minuteStep && (hour === "*" || hourStep)) {
    const n = minuteStep[1];
    return n === "1" ? "Every minute" : `Every ${n} minutes`;
  }
  if (hourStep) {
    const n = hourStep[1];
    const atMinute =
      minute !== "*" && minute !== "0" ? ` at minute ${minute}` : "";
    return `${n === "1" ? "Every hour" : `Every ${n} hours`}${atMinute}`;
  }
  if (hour === "*" && minute !== "*") {
    const m = parseInt(minute, 10);
    return Number.isNaN(m) || m === 0
      ? "Every hour"
      : `Every hour at minute ${m}`;
  }
  if (minute === "*" && hour !== "*") {
    return `Every minute during hour ${hour}`;
  }
  if (minute === "*" && hour === "*") {
    return "Every minute";
  }
  return null;
}

function describeDayOfWeek(dow: string): string | null {
  if (dow === "*") return null;
  if (dow === "1-5") return "on weekdays";
  if (dow === "0,6" || dow === "6,0") return "on weekends";
  const named = dow.split(",").map((token) => {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const start = WEEKDAY_NAMES[parseInt(range[1], 10) % 7];
      const end = WEEKDAY_NAMES[parseInt(range[2], 10) % 7];
      return `${start}-${end}`;
    }
    const n = parseInt(token, 10);
    return Number.isNaN(n) ? token : WEEKDAY_NAMES[n % 7];
  });
  return `on ${named.join(", ")}`;
}

function describeDayOfMonth(dom: string): string | null {
  if (dom === "*") return null;
  const step = /^\*\/(\d+)$/.exec(dom);
  if (step) return `every ${step[1]} days`;
  const plural = dom.includes(",") || dom.includes("-") ? "s" : "";
  return `on day${plural} ${dom} of the month`;
}

function describeMonth(month: string): string {
  if (/^\d+$/.test(month)) {
    const n = parseInt(month, 10);
    if (n >= 1 && n <= 12) return MONTH_NAMES[n - 1];
  }
  return month;
}

/**
 * Produces a short human sentence describing a cron expression (5-field, or
 * 6-field with a leading seconds column), e.g. "Every day at 09:00" or
 * "On weekdays at 09:00". Falls back to echoing the raw expression for
 * anything it can't confidently phrase.
 */
export function describeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return expr;
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    parts.length === 6 ? parts.slice(1) : parts;

  const monthPart = month === "*" ? "" : ` in ${describeMonth(month)}`;
  const dowPart = describeDayOfWeek(dayOfWeek);
  const domPart = describeDayOfMonth(dayOfMonth);
  const dayPart = [dowPart, domPart].filter(Boolean).join(" ");

  const frequency = describeFrequency(minute, hour);
  if (frequency) {
    return `${frequency}${dayPart ? ` ${dayPart}` : ""}${monthPart}`;
  }

  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return expr;
  const at = ` at ${pad(h)}:${pad(m)}`;

  if (dayPart) return `${capitalize(dayPart)}${at}${monthPart}`;
  return `Every day${at}${monthPart}`;
}
