import { describe, expect, it } from "vitest";

import { classifyDelivery, formatFinding, type DeliveryEvidence } from "../delivery-check.js";

const baseEvidence: DeliveryEvidence = {
  appUrl: "http://127.0.0.1:3011",
  probedUrl: "http://127.0.0.1:3011",
  pendingCount: 0,
  everImported: true,
};

describe("classifyDelivery", () => {
  it("app_down when the probe errored — queueing is legitimate, so a fix mentions waiting, not refusal", () => {
    const f = classifyDelivery({ ...baseEvidence, probeError: "ECONNREFUSED" });
    expect(f.state).toBe("app_down");
    expect(f.fix).toContain("queue on disk");
  });

  it("ingress_blocked on 404 — the gate is refusing this origin, nothing will ever import", () => {
    const f = classifyDelivery({
      ...baseEvidence,
      browserOrigin: "https://box.example.ts.net:8444",
      probedUrl: "https://box.example.ts.net:8444",
      probeStatus: 404,
    });
    expect(f.state).toBe("ingress_blocked");
    expect(f.summary).toContain("box.example.ts.net");
    expect(f.fix).toContain("FRAGMENT_INGRESS_ALLOWED_HOSTS");
  });

  it("ok on 2xx with an empty inbox", () => {
    const f = classifyDelivery({ ...baseEvidence, probeStatus: 200 });
    expect(f.state).toBe("ok");
    expect(f.summary).not.toContain("waiting");
  });

  it("ok on 2xx but calls out a stale backlog (> 60 min) without treating it as failure", () => {
    const f = classifyDelivery({
      ...baseEvidence,
      probeStatus: 200,
      pendingCount: 9,
      oldestPendingMinutes: 1620,
    });
    expect(f.state).toBe("ok");
    expect(f.summary).toContain("9 piece(s) are still waiting");
    expect(f.summary).toContain("1620 min");
  });

  it("a fresh backlog (<= 60 min) is mentioned but not flagged stale", () => {
    const f = classifyDelivery({
      ...baseEvidence,
      probeStatus: 200,
      pendingCount: 2,
      oldestPendingMinutes: 5,
    });
    expect(f.state).toBe("ok");
    expect(f.summary).toContain("2 piece(s) waiting to import");
  });

  it("unknown for any other status", () => {
    const f = classifyDelivery({ ...baseEvidence, probeStatus: 500 });
    expect(f.state).toBe("unknown");
    expect(f.summary).toContain("500");
  });
});

describe("formatFinding", () => {
  it("marks non-ok states FAIL and warns when no browser origin is configured", () => {
    const report = formatFinding(
      classifyDelivery({ ...baseEvidence, probeStatus: 404 }),
    );
    expect(report).toContain("[FAIL]");
    expect(report).toContain("set FRAGMENT_APP_ORIGIN");
  });

  it("marks ok states OK and includes the probe evidence", () => {
    const report = formatFinding(
      classifyDelivery({
        ...baseEvidence,
        browserOrigin: "https://box.example.ts.net:8444",
        probedUrl: "https://box.example.ts.net:8444",
        probeStatus: 200,
      }),
    );
    expect(report).toContain("[OK]");
    expect(report).toContain("probe status    200");
    expect(report).toContain("https://box.example.ts.net:8444");
  });
});
