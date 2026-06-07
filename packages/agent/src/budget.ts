import { BudgetExceededError, type Budget } from "./types.js";

/** Parse a price string like "$0.10" or "0.10" to a number. */
export function parsePriceUsd(price: string): number {
  const trimmed = price.trim().replace(/^\$/, "");
  if (!trimmed) throw new Error(`Invalid price string: "${price}"`);
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid price string: "${price}"`);
  }
  return n;
}

/** UTC YYYY-MM-DD key, used as the daily bucket. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Convert a USDC micro-amount string (6 decimals) to a USD number.
 *   microUsdcToUsd("1234567") -> 1.234567
 */
export function microUsdcToUsd(microStr: string): number {
  const n = Number(microStr);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n / 1_000_000;
}

/**
 * BudgetTracker is an interface — agents can plug in their own (KV-backed,
 * Redis, etc.) without touching SDK internals. The default implementation,
 * `createInMemoryBudgetTracker`, is good enough for one-shot CLIs and
 * single-process agents but is **silently wrong for multi-instance Workers**
 * because state lives in a per-process closure. Provide your own for those
 * deployments.
 */
export type BudgetTracker = {
  /**
   * Check whether an upcoming charge would breach caps. Throws
   * `BudgetExceededError` if it would. Does NOT record the charge.
   */
  check: (serviceId: string, costUsd: number) => void;
  /** Record a successful charge against the daily bucket. */
  record: (costUsd: number, now?: Date) => void;
  /** Read the current daily total in USD. */
  spentToday: (now?: Date) => number;
};

/**
 * In-memory tracker. Counters are per-process and reset on restart.
 * Daily totals are bucketed by UTC calendar day.
 */
export function createInMemoryBudgetTracker(budget?: Budget): BudgetTracker {
  const perCallCap = budget?.perCall ? parsePriceUsd(budget.perCall) : undefined;
  const perDayCap = budget?.perDay ? parsePriceUsd(budget.perDay) : undefined;
  const daily = new Map<string, number>();

  return {
    check(serviceId, costUsd) {
      if (perCallCap !== undefined && costUsd > perCallCap) {
        throw new BudgetExceededError("perCall", costUsd, perCallCap, serviceId);
      }
      if (perDayCap !== undefined) {
        const today = daily.get(dayKey()) ?? 0;
        if (today + costUsd > perDayCap) {
          throw new BudgetExceededError(
            "perDay",
            today + costUsd,
            perDayCap,
            serviceId,
          );
        }
      }
    },
    record(costUsd, now = new Date()) {
      const key = dayKey(now);
      daily.set(key, (daily.get(key) ?? 0) + costUsd);
    },
    spentToday(now = new Date()) {
      return daily.get(dayKey(now)) ?? 0;
    },
  };
}

/**
 * @deprecated Renamed to `createInMemoryBudgetTracker`. Kept as an alias for
 * backward compatibility; the new name makes the per-process scope explicit.
 */
export const createBudgetTracker = createInMemoryBudgetTracker;
