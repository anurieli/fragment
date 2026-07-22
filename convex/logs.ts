import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const logValidator = v.object({
  route: v.string(),
  caller: v.string(),
  provider: v.string(),
  model: v.string(),
  status: v.string(),
  statusCode: v.number(),
  error: v.optional(v.string()),
  durationMs: v.number(),
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  cost: v.optional(v.number()),
  promptLength: v.number(),
  responseLength: v.number(),
  clientTimestamp: v.number(),
});

export const batchInsertLogs = internalMutation({
  args: {
    deviceId: v.string(),
    logs: v.array(logValidator),
  },
  handler: async (ctx, args) => {
    const batch = args.logs.slice(0, 100);
    for (const log of batch) {
      await ctx.db.insert("apiLogs", {
        deviceId: args.deviceId,
        route: log.route,
        caller: log.caller,
        provider: log.provider,
        model: log.model,
        status: log.status,
        statusCode: log.statusCode,
        error: log.error,
        durationMs: log.durationMs,
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        cost: log.cost,
        promptLength: log.promptLength,
        responseLength: log.responseLength,
        clientTimestamp: log.clientTimestamp,
      });
    }
  },
});

export const getLogStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allLogs = await ctx.db.query("apiLogs").collect();

    const byRoute: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    let totalCost = 0;

    for (const log of allLogs) {
      byRoute[log.route] = (byRoute[log.route] ?? 0) + 1;
      byProvider[log.provider] = (byProvider[log.provider] ?? 0) + 1;
      totalCost += log.cost ?? 0;
    }

    return {
      totalCount: allLogs.length,
      byRoute,
      byProvider,
      totalCost,
    };
  },
});
