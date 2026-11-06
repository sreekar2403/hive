import { getDb } from "./db/database";
import type { Config } from "./config";

let db: ReturnType<typeof getDb> | null = null;

/** Get the BetterSQLite3 db instance, initialising if needed. */
function ensureDb(): ReturnType<typeof getDb> | null {
  if (db) return db;
  try {
    db = getDb();
  } catch (err) {
    // If we can't initialise the DB, db stays null and callers fall back to
    // no-op tracking. This lets the server start even without write
    // permission on the data directory.
    console.warn("[budget] could not initialise SQLite DB:", err);
    db = null;
  }
  return db;
}

/** UTC date string YYYY-MM-DD for today. */
function todayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** Insert a spend event into the DB. Best-effort: a DB failure never
 *  breaks the budget flow. */
function recordSpendDB(
  projectId: string,
  tokens: number,
  costUsd: number,
  taskId?: string,
): void {
  const database = ensureDb();
  if (!database) return; // DB unavailable — fall back to no-op

  try {
    const id = `spend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    database
      .prepare(
        `INSERT INTO spend_events (id, project_id, date, tokens, cost_usd, task_id)
       VALUES (@id, @project_id, @date, @tokens, @cost_usd, @task_id)`,
      )
      .run({
        id,
        project_id: projectId,
        date: todayDate(),
        tokens,
        cost_usd: costUsd,
        task_id: taskId ?? null,
      });
  } catch (err) {
    console.warn("[budget] failed to record spend event:", err);
  }
}

/** Read cumulative tokens/cost for a given project+date from the DB. */
function readSpendDB(projectId: string): { tokens: number; costUsd: number } {
  const database = ensureDb();
  if (!database) return { tokens: 0, costUsd: 0 };

  try {
    const row = database
      .prepare(
        `SELECT SUM(tokens) as tokens, SUM(cost_usd) as cost_usd FROM spend_events WHERE project_id = ? AND date = ?`,
      )
      .get(projectId, todayDate()) as {
      tokens?: number;
      cost_usd?: number;
    };
    return {
      tokens: row.tokens ?? 0,
      costUsd: row.cost_usd ?? 0,
    };
  } catch (err) {
    console.warn("[budget] failed to read spend from DB:", err);
    return { tokens: 0, costUsd: 0 };
  }
}

/**
 * BudgetManager — tracks token/cost spend per project per day and enforces
 * ceilings defined in the server config.
 *
 * Invariants:
 * - `enabled: false` (default) means all runs are admitted.
 * - `maxTokens: 0` / `maxCostUsd: 0` means unlimited for that ceiling.
 * - Spend is cumulative per UTC day per project.
 */
export class BudgetManager {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Record that a task just consumed `tokens` tokens costing `costUsd`
   * units of money. The spend is attributed to `projectId` and today's UTC date.
   */
  recordSpend(projectId: string, tokens: number, costUsd: number): void {
    if (!this.config.budget.enabled) return;
    recordSpendDB(projectId, tokens, costUsd);
  }

  /**
   * Check whether a request for `tokens` tokens costing `costUsd` would
   * exceed this project's and/or the daily ceiling.
   *
   * Returns { allowed: boolean, reason?: string }.
   * - If the ceiling would be exceeded, `allowed` is false and `reason`
   *   explains which ceiling was hit (daily or per-project).
   * - If `enabled` is false, always returns { allowed: true }.
   * - If a ceiling value is 0, it is treated as unlimited.
   */
  canAdmit(
    projectId: string,
    tokens: number,
    costUsd: number,
  ): { allowed: boolean; reason?: string } {
    if (!this.config.budget.enabled) return { allowed: true };

    // Read current cumulative spend for today
    const cumulative = readSpendDB(projectId);

    const daily = this.config.budget.daily;
    const perProject = this.config.budget.perProject[projectId] ?? {};

    // Check daily ceiling (global, same for every project)
    if (daily.maxTokens > 0 && cumulative.tokens + tokens > daily.maxTokens) {
      return {
        allowed: false,
        reason: `Daily token ceiling exceeded: ${cumulative.tokens + tokens} > ${daily.maxTokens}`,
      };
    }
    if (
      daily.maxCostUsd > 0 &&
      cumulative.costUsd + costUsd > daily.maxCostUsd
    ) {
      return {
        allowed: false,
        reason: `Daily cost ceiling exceeded: $${(
          cumulative.costUsd + costUsd
        ).toFixed(4)} > $${daily.maxCostUsd.toFixed(4)}`,
      };
    }

    // Check per-project ceiling
    const pmaxTokens = perProject.maxTokens ?? 0;
    const pmaxCostUsd = perProject.maxCostUsd ?? 0;
    if (pmaxTokens > 0 && cumulative.tokens + tokens > pmaxTokens) {
      return {
        allowed: false,
        reason: `Per-project token ceiling exceeded: ${cumulative.tokens + tokens} > ${pmaxTokens}`,
      };
    }
    if (pmaxCostUsd > 0 && cumulative.costUsd + costUsd > pmaxCostUsd) {
      return {
        allowed: false,
        reason: `Per-project cost ceiling exceeded: $${(
          cumulative.costUsd + costUsd
        ).toFixed(4)} > $${pmaxCostUsd.toFixed(4)}`,
      };
    }

    return { allowed: true };
  }
}
