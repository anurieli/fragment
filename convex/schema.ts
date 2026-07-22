import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    deviceId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    platform: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    writingTypes: v.optional(v.array(v.string())),
    role: v.optional(v.string()),
    onboardingCompletedAt: v.optional(v.number()),
    profileSource: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_deviceId", ["deviceId"]),

  feedback: defineTable({
    deviceId: v.string(),
    type: v.union(v.literal("bug"), v.literal("feature"), v.literal("feedback")),
    message: v.string(),
    status: v.string(),
    screenshotId: v.optional(v.id("_storage")),
    screenRecordingId: v.optional(v.id("_storage")),
    voiceNoteId: v.optional(v.id("_storage")),
    platform: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    screenResolution: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    activeNoteId: v.optional(v.string()),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_status", ["status"])
    .index("by_type", ["type"]),

  apiLogs: defineTable({
    deviceId: v.string(),
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
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_route", ["route"])
    .index("by_provider", ["provider"]),
});
