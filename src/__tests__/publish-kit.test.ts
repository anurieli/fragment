import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildKitBroadcastRequest,
  createKitBroadcast,
  kitErrorMessage,
  deriveKitSubject,
  isKitEligibleFormat,
  canPublishToKit,
  KitApiError,
} from "@/lib/publish/kit";

// ---------------------------------------------------------------------------
// buildKitBroadcastRequest — pure, no network
// ---------------------------------------------------------------------------

describe("buildKitBroadcastRequest", () => {
  it("sends the X-Kit-Api-Key header and JSON content-type", () => {
    const req = buildKitBroadcastRequest({
      apiKey: "kit_abc123",
      subject: "Hello",
      contentHtml: "<p>Hi</p>",
    });
    expect(req.url).toBe("https://api.kit.com/v4/broadcasts");
    expect(req.headers["X-Kit-Api-Key"]).toBe("kit_abc123");
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("draft (no sendAt): omits send_at entirely", () => {
    const req = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
    });
    expect(req.body.subject).toBe("Subject");
    expect(req.body.content).toBe("<p>Body</p>");
    expect("send_at" in req.body).toBe(false);
  });

  it("scheduled: converts epoch ms sendAt to an ISO-8601 string", () => {
    const epochMs = Date.parse("2026-08-01T12:00:00.000Z");
    const req = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
      sendAt: epochMs,
    });
    expect(req.body.send_at).toBe("2026-08-01T12:00:00.000Z");
  });

  it("public: true is passed through when set", () => {
    const req = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
      publicPost: true,
    });
    expect(req.body.public).toBe(true);
  });

  it("public omitted when not specified", () => {
    const req = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
    });
    expect("public" in req.body).toBe(false);
  });

  it("includes preview_text only when provided", () => {
    const withPreview = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
      previewText: "A preview",
    });
    expect(withPreview.body.preview_text).toBe("A preview");

    const withoutPreview = buildKitBroadcastRequest({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
    });
    expect("preview_text" in withoutPreview.body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kitErrorMessage — pure status/body -> readable message mapping
// ---------------------------------------------------------------------------

describe("kitErrorMessage", () => {
  it("401: hints to check the API key in Settings", () => {
    const msg = kitErrorMessage(401, undefined);
    expect(msg.toLowerCase()).toContain("api key");
    expect(msg.toLowerCase()).toContain("settings");
  });

  it("403: also treated as an invalid-key error", () => {
    const msg = kitErrorMessage(403, undefined);
    expect(msg.toLowerCase()).toContain("api key");
  });

  it("429: mentions the rate limit", () => {
    const msg = kitErrorMessage(429, undefined);
    expect(msg.toLowerCase()).toContain("rate limit");
  });

  it("422: surfaces a validation detail from the response body when present", () => {
    const msg = kitErrorMessage(422, { message: "subject can't be blank" });
    expect(msg).toContain("subject can't be blank");
  });

  it("422: falls back to a generic validation message with no body detail", () => {
    const msg = kitErrorMessage(422, undefined);
    expect(msg.toLowerCase()).toContain("rejected the broadcast");
  });

  it("422: joins multiple errors from an errors array", () => {
    const msg = kitErrorMessage(422, { errors: ["subject is required", "content is required"] });
    expect(msg).toContain("subject is required");
    expect(msg).toContain("content is required");
  });

  it("unknown status: generic message including the status code", () => {
    const msg = kitErrorMessage(500, undefined);
    expect(msg).toContain("500");
  });

  it("unknown status with a detail: includes the detail", () => {
    const msg = kitErrorMessage(500, { error: "internal error" });
    expect(msg).toContain("internal error");
  });
});

// ---------------------------------------------------------------------------
// deriveKitSubject — title/first-line derivation + 80-char truncation
// ---------------------------------------------------------------------------

describe("deriveKitSubject", () => {
  it("uses the title when set", () => {
    expect(deriveKitSubject("My Essay Title", "Some body text.")).toBe("My Essay Title");
  });

  it("falls back to the first non-empty line of the body when no title", () => {
    expect(deriveKitSubject(undefined, "\n\nFirst real line.\nSecond line.")).toBe("First real line.");
  });

  it("falls back to the first non-empty line when title is blank/whitespace", () => {
    expect(deriveKitSubject("   ", "Body first line.")).toBe("Body first line.");
  });

  it("strips a leading markdown heading marker from the fallback line", () => {
    expect(deriveKitSubject(undefined, "## A Heading\nBody.")).toBe("A Heading");
  });

  it("truncates to 80 characters with an ellipsis when the source is longer", () => {
    const long = "x".repeat(100);
    const subject = deriveKitSubject(long, "body");
    expect(subject.length).toBe(80);
    expect(subject.endsWith("…")).toBe(true);
    expect(subject.startsWith("x".repeat(79))).toBe(true);
  });

  it("does not truncate a source exactly at the 80-character limit", () => {
    const exact = "x".repeat(80);
    expect(deriveKitSubject(exact, "body")).toBe(exact);
  });

  it("returns an empty string when there is no title and no non-empty body line", () => {
    expect(deriveKitSubject(undefined, "\n\n   \n")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isKitEligibleFormat / canPublishToKit — share-menu eligibility gating
// ---------------------------------------------------------------------------

describe("isKitEligibleFormat", () => {
  it("substack, essay, and other are eligible", () => {
    expect(isKitEligibleFormat("substack")).toBe(true);
    expect(isKitEligibleFormat("essay")).toBe(true);
    expect(isKitEligibleFormat("other")).toBe(true);
  });

  it("tweet, linkedin, and script are not eligible", () => {
    expect(isKitEligibleFormat("tweet")).toBe(false);
    expect(isKitEligibleFormat("linkedin")).toBe(false);
    expect(isKitEligibleFormat("script")).toBe(false);
  });
});

describe("canPublishToKit", () => {
  it("true when the format is eligible and a non-blank key is present", () => {
    expect(canPublishToKit("essay", "kit_abc123")).toBe(true);
  });

  it("false when the format is eligible but the key is missing", () => {
    expect(canPublishToKit("essay", undefined)).toBe(false);
    expect(canPublishToKit("essay", "")).toBe(false);
  });

  it("false when the key is present but whitespace-only", () => {
    expect(canPublishToKit("essay", "   ")).toBe(false);
  });

  it("false when the format is not eligible, even with a key present", () => {
    expect(canPublishToKit("tweet", "kit_abc123")).toBe(false);
    expect(canPublishToKit("linkedin", "kit_abc123")).toBe(false);
    expect(canPublishToKit("script", "kit_abc123")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createKitBroadcast — network path, fully mocked (no real Kit API access
// is available in this environment; every assertion here is against a
// mocked fetch response).
// ---------------------------------------------------------------------------

describe("createKitBroadcast", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the broadcast id and a best-effort edit URL on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ broadcast: { id: 42 } }), { status: 201 }),
    );

    const result = await createKitBroadcast({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
    });

    expect(result.id).toBe("42");
    expect(result.url).toBe("https://app.kit.com/broadcasts/42");
  });

  it("accepts a top-level id (no broadcast wrapper) in the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "abc" }), { status: 200 }));

    const result = await createKitBroadcast({
      apiKey: "key",
      subject: "Subject",
      contentHtml: "<p>Body</p>",
    });
    expect(result.id).toBe("abc");
  });

  it("throws a KitApiError with a readable message on 401", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "invalid key" }), { status: 401 }));

    await expect(
      createKitBroadcast({ apiKey: "bad", subject: "S", contentHtml: "<p>B</p>" }),
    ).rejects.toMatchObject({ status: 401, kind: "invalid_key" });
  });

  it("throws a KitApiError on 429", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));

    await expect(
      createKitBroadcast({ apiKey: "key", subject: "S", contentHtml: "<p>B</p>" }),
    ).rejects.toMatchObject({ status: 429, kind: "rate_limited" });
  });

  it("throws a KitApiError on 422 with the response detail in the message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "subject can't be blank" }), { status: 422 }),
    );

    await expect(
      createKitBroadcast({ apiKey: "key", subject: "", contentHtml: "<p>B</p>" }),
    ).rejects.toThrow(/subject can't be blank/);
  });

  it("throws a network KitApiError when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(
      createKitBroadcast({ apiKey: "key", subject: "S", contentHtml: "<p>B</p>" }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("KitApiError instances are real Error instances", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    try {
      await createKitBroadcast({ apiKey: "key", subject: "S", contentHtml: "<p>B</p>" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KitApiError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("passes send_at through when scheduling (draft vs scheduled request body)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "1" }), { status: 200 }));

    await createKitBroadcast({
      apiKey: "key",
      subject: "S",
      contentHtml: "<p>B</p>",
      sendAt: Date.parse("2026-09-01T00:00:00.000Z"),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.send_at).toBe("2026-09-01T00:00:00.000Z");
  });
});
