/**
 * The login-CSRF guard.
 *
 * `POST /api/v1/auth/session` mints a session cookie from an id_token. Without
 * an origin check, an attacker's page can submit their OWN valid token as a
 * cross-site form and plant a session for THEIR account in the victim's
 * browser. The victim then writes into it, and on first link the sync engine
 * seeds every local note into it. These tests pin both barriers.
 */

import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";

import { isCrossSite, isNotJsonBody, guardJsonMutation } from "@/lib/server/csrf";

function req(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("isCrossSite", () => {
  it("allows a same-origin browser request", () => {
    expect(
      isCrossSite(req({ origin: "https://fragment.app", host: "fragment.app" })),
    ).toBe(false);
  });

  it("refuses an origin that is not ours", () => {
    expect(
      isCrossSite(req({ origin: "https://evil.example", host: "fragment.app" })),
    ).toBe(true);
  });

  it("refuses a lookalike subdomain", () => {
    expect(
      isCrossSite(req({ origin: "https://fragment.app.evil.example", host: "fragment.app" })),
    ).toBe(true);
  });

  it("allows a caller that sends no Origin at all", () => {
    // The Tauri desktop build and curl. A browser always sends Origin on a
    // cross-origin POST, so absence cannot be an attacker's page.
    expect(isCrossSite(req({ host: "fragment.app" }))).toBe(false);
  });

  it("refuses an unparseable Origin", () => {
    expect(isCrossSite(req({ origin: "not a url", host: "fragment.app" }))).toBe(true);
  });

  it("compares host including port, so a different port is cross-site", () => {
    expect(
      isCrossSite(req({ origin: "http://localhost:1234", host: "localhost:3100" })),
    ).toBe(true);
  });
});

describe("isNotJsonBody", () => {
  it("accepts application/json, with or without a charset", () => {
    expect(isNotJsonBody(req({ "content-type": "application/json" }))).toBe(false);
    expect(
      isNotJsonBody(req({ "content-type": "application/json; charset=utf-8" })),
    ).toBe(false);
  });

  it("refuses the three content types an HTML form can send", () => {
    // This is the barrier that blocks text/plain body smuggling, where a form
    // field name carries the JSON and req.json() parses it happily.
    for (const type of [
      "text/plain",
      "multipart/form-data; boundary=x",
      "application/x-www-form-urlencoded",
    ]) {
      expect(isNotJsonBody(req({ "content-type": type }))).toBe(true);
    }
  });

  it("refuses a missing content type", () => {
    expect(isNotJsonBody(req({}))).toBe(true);
  });
});

describe("guardJsonMutation", () => {
  it("passes a legitimate same-origin JSON request", () => {
    expect(
      guardJsonMutation(
        req({
          origin: "https://fragment.app",
          host: "fragment.app",
          "content-type": "application/json",
        }),
      ),
    ).toBeNull();
  });

  it("refuses the cross-site text/plain form attack with 403", () => {
    const res = guardJsonMutation(
      req({
        origin: "https://evil.example",
        host: "fragment.app",
        "content-type": "text/plain",
      }),
    );
    expect(res?.status).toBe(403);
  });

  it("refuses a same-origin form post with 415, so content type alone suffices", () => {
    const res = guardJsonMutation(
      req({ host: "fragment.app", "content-type": "text/plain" }),
    );
    expect(res?.status).toBe(415);
  });
});
