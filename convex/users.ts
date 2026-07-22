import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const upsertUser = internalMutation({
  args: {
    deviceId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    platform: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    writingTypes: v.optional(v.array(v.string())),
    role: v.optional(v.string()),
    profileSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    const now = Date.now();

    if (existing) {
      const updates: Record<string, unknown> = { lastSeenAt: now };

      if (args.name !== undefined) updates.name = args.name;
      if (args.email !== undefined) updates.email = args.email;
      if (args.platform !== undefined) updates.platform = args.platform;
      if (args.appVersion !== undefined) updates.appVersion = args.appVersion;
      if (args.writingTypes !== undefined) updates.writingTypes = args.writingTypes;
      if (args.role !== undefined) updates.role = args.role;
      if (args.profileSource !== undefined) updates.profileSource = args.profileSource;

      // Set onboardingCompletedAt on first profile data arrival
      const hasProfileData = args.name !== undefined || args.email !== undefined || args.role !== undefined;
      if (hasProfileData && existing.onboardingCompletedAt === undefined) {
        updates.onboardingCompletedAt = now;
      }

      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    const hasProfileData = args.name !== undefined || args.email !== undefined || args.role !== undefined;

    return await ctx.db.insert("users", {
      deviceId: args.deviceId,
      name: args.name,
      email: args.email,
      platform: args.platform,
      appVersion: args.appVersion,
      writingTypes: args.writingTypes,
      role: args.role,
      profileSource: args.profileSource,
      onboardingCompletedAt: hasProfileData ? now : undefined,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  },
});

export const getUserByDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
  },
});

// Admin/maintenance utility: delete a single user row by deviceId.
// internalMutation only — not exposed over HTTP, callable via `npx convex run`.
export const deleteUserByDeviceId = internalMutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!existing) return { deleted: false };
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const listUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").order("desc").collect();
  },
});
