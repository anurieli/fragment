import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function optionsHandler(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

const identify = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const id = await ctx.runMutation(internal.users.upsertUser, body);
    return jsonResponse({ success: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

const submitFeedback = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const id = await ctx.runMutation(internal.feedback.createFeedback, body);
    return jsonResponse({ success: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

const uploadUrl = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const deviceId = body.deviceId;
    if (!deviceId || typeof deviceId !== "string") {
      return jsonResponse({ success: false, error: "deviceId required" }, 400);
    }
    // Verify device is registered
    const user = await ctx.runQuery(internal.users.getUserByDeviceId, { deviceId });
    if (!user) {
      return jsonResponse({ success: false, error: "Unknown device" }, 403);
    }
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return jsonResponse({ success: true, uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

const submitLogs = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    await ctx.runMutation(internal.logs.batchInsertLogs, {
      deviceId: body.deviceId,
      logs: body.logs,
    });
    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

const optionsAction = httpAction(async () => {
  return optionsHandler();
});

const http = httpRouter();

http.route({
  path: "/identify",
  method: "POST",
  handler: identify,
});
http.route({
  path: "/identify",
  method: "OPTIONS",
  handler: optionsAction,
});

http.route({
  path: "/feedback",
  method: "POST",
  handler: submitFeedback,
});
http.route({
  path: "/feedback",
  method: "OPTIONS",
  handler: optionsAction,
});

http.route({
  path: "/upload-url",
  method: "POST",
  handler: uploadUrl,
});
http.route({
  path: "/upload-url",
  method: "OPTIONS",
  handler: optionsAction,
});

http.route({
  path: "/logs",
  method: "POST",
  handler: submitLogs,
});
http.route({
  path: "/logs",
  method: "OPTIONS",
  handler: optionsAction,
});

export default http;
