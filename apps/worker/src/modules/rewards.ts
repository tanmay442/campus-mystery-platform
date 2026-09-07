/** Phase 1 platform-credit balance reads and transaction history. */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { loadUserRow, resolveRequestUser } from "./challenges";
import type { CreditTxRow } from "./challenges";
import type { AppContext } from "../lib/errors";
import { errorResponse } from "../lib/errors";

const HISTORY_LIMIT = 50;

const creditTxListSchema = z.array(
  z
    .object({
      id: z.string(),
      user_id: z.string(),
      event_id: z.string().nullable(),
      amount: z.number(),
      reason: z.string(),
      reference_id: z.string().nullable(),
      created_at: z.string()
    })
    .catchall(z.unknown())
);

export const rewardsRouter = new Hono<AppEnv>();

async function loadHistory(c: AppContext, limit: number): Promise<Response> {
  const user = await resolveRequestUser(c);
  if (user === undefined) {
    return errorResponse(c, "UNAUTHENTICATED", "Authentication required");
  }
  const db = c.env.DB;
  const row = await loadUserRow(db, user.id);
  if (row === undefined) {
    return errorResponse(c, "NOT_FOUND", "User not found");
  }
  const raw = (await db
    .prepare(
      "/*Q:credit_txs_by_user*/ SELECT id, user_id, event_id, amount, reason, reference_id, created_at FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .bind(user.id, limit)
    .all()).results;
  const parsed = creditTxListSchema.safeParse(raw);
  const transactions: CreditTxRow[] = parsed.success ? parsed.data : [];
  return c.json({
    balance: row.platform_credits,
    transactions: transactions.map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      reason: entry.reason,
      eventId: entry.event_id,
      referenceId: entry.reference_id,
      createdAt: entry.created_at
    }))
  });
}

rewardsRouter.get("/api/me/credits", async (c) => {
  return loadHistory(c, 0);
});

rewardsRouter.get("/api/me/credits/history", async (c) => {
  return loadHistory(c, HISTORY_LIMIT);
});
