import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const createFeedback = internalMutation({
  args: {
    deviceId: v.string(),
    type: v.union(v.literal("bug"), v.literal("feature"), v.literal("feedback")),
    message: v.string(),
    status: v.optional(v.string()),
    screenshotId: v.optional(v.id("_storage")),
    screenRecordingId: v.optional(v.id("_storage")),
    voiceNoteId: v.optional(v.id("_storage")),
    platform: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    screenResolution: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    activeNoteId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("feedback", {
      deviceId: args.deviceId,
      type: args.type,
      message: args.message,
      status: args.status ?? "new",
      screenshotId: args.screenshotId,
      screenRecordingId: args.screenRecordingId,
      voiceNoteId: args.voiceNoteId,
      platform: args.platform,
      appVersion: args.appVersion,
      screenResolution: args.screenResolution,
      userAgent: args.userAgent,
      activeNoteId: args.activeNoteId,
    });
  },
});

export const listFeedback = internalQuery({
  args: {
    type: v.optional(v.union(v.literal("bug"), v.literal("feature"), v.literal("feedback"))),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.type !== undefined) {
      return await ctx.db
        .query("feedback")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .order("desc")
        .collect();
    }

    if (args.status !== undefined) {
      return await ctx.db
        .query("feedback")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .collect();
    }

    return await ctx.db.query("feedback").order("desc").collect();
  },
});

export const updateFeedbackStatus = internalMutation({
  args: {
    id: v.id("feedback"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
  },
});
