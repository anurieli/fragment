import { describe, it, expect } from "vitest";
import { sanitizeForSync, mergeFromSync } from "@/lib/sync/collections";

/**
 * The guarantee these protect: a user's own provider API keys stay on their
 * machine even though the settings record they live in does sync.
 *
 * Both directions matter. Stripping on the way up keeps the key out of the
 * database; restoring on the way down stops the stripped record from wiping
 * the local key when the same settings row comes back from another device.
 */

describe("sanitizeForSync", () => {
  it("strips provider credentials from settings", () => {
    const settings = {
      id: "app",
      providerCredentials: { openaiApiKey: "sk-live-secret", codexAccessToken: "tok" },
      userProfile: { displayName: "Ariel" },
    };

    const out = sanitizeForSync("settings", settings);

    expect(out.providerCredentials).toBeUndefined();
    expect(out.userProfile).toEqual({ displayName: "Ariel" });
    expect(JSON.stringify(out)).not.toContain("sk-live-secret");
  });

  it("does not mutate the record it was given", () => {
    const settings = { id: "app", providerCredentials: { openaiApiKey: "sk-live" } };
    sanitizeForSync("settings", settings);
    expect(settings.providerCredentials).toEqual({ openaiApiKey: "sk-live" });
  });

  it("leaves collections with nothing to strip untouched", () => {
    const note = { id: "n1", content: "hello", title: "A note" };
    expect(sanitizeForSync("notes", note)).toBe(note);
  });
});

describe("mergeFromSync", () => {
  it("restores local credentials onto an incoming settings record", () => {
    const incoming = { id: "app", userProfile: { displayName: "Ariel" } };
    const local = { id: "app", providerCredentials: { openaiApiKey: "sk-local" } };

    const merged = mergeFromSync("settings", incoming, local);

    expect(merged.providerCredentials).toEqual({ openaiApiKey: "sk-local" });
    expect(merged.userProfile).toEqual({ displayName: "Ariel" });
  });

  it("leaves credentials absent when this device has none", () => {
    const merged = mergeFromSync("settings", { id: "app" }, { id: "app" });
    expect("providerCredentials" in merged).toBe(false);
  });

  it("returns the incoming record when there is nothing local yet", () => {
    const incoming = { id: "app", userProfile: {} };
    expect(mergeFromSync("settings", incoming, undefined)).toBe(incoming);
  });

  it("passes other collections straight through", () => {
    const incoming = { id: "n1", content: "hello" };
    expect(mergeFromSync("notes", incoming, { id: "n1", content: "old" })).toBe(incoming);
  });

  it("survives a full round trip without losing the key", () => {
    const local = {
      id: "app",
      providerCredentials: { openaiApiKey: "sk-local" },
      userProfile: { displayName: "Old" },
    };

    // What another device would have sent up, and what comes back down.
    const fromWire = sanitizeForSync("settings", {
      id: "app",
      providerCredentials: { openaiApiKey: "sk-other-device" },
      userProfile: { displayName: "New" },
    });

    const applied = mergeFromSync("settings", fromWire, local);

    expect(applied.userProfile).toEqual({ displayName: "New" });
    expect(applied.providerCredentials).toEqual({ openaiApiKey: "sk-local" });
  });
});

/**
 * Nested credentials.
 *
 * The first version of STRIPPED_FIELDS listed only `providerCredentials`, so
 * three keys that live under `userProfile` synced to the server in plaintext:
 * a Kit key (full control of the writer's mailing list) and a Composio key
 * plus connected-account id (permission to post to their LinkedIn as them).
 * A field belongs on the strip list because of what it can do, not because of
 * where it sits in the object.
 */
describe("nested credential stripping", () => {
  const settings = () => ({
    id: "app",
    providerCredentials: { openaiApiKey: "sk-provider" },
    userProfile: {
      displayName: "Ariel",
      email: "a@example.com",
      kitApiKey: "kit-live-secret",
      composioApiKey: "comp-live-secret",
      linkedInConnectedAccountId: "acct_123",
    },
    theme: "dark",
  });

  it("strips the integration keys nested under userProfile", () => {
    const out = sanitizeForSync("settings", settings());
    const profile = out.userProfile as Record<string, unknown>;

    expect(profile.kitApiKey).toBeUndefined();
    expect(profile.composioApiKey).toBeUndefined();
    expect(profile.linkedInConnectedAccountId).toBeUndefined();

    const wire = JSON.stringify(out);
    expect(wire).not.toContain("kit-live-secret");
    expect(wire).not.toContain("comp-live-secret");
    expect(wire).not.toContain("acct_123");
  });

  it("keeps the rest of the profile, which is the point of syncing settings", () => {
    const profile = sanitizeForSync("settings", settings()).userProfile as Record<string, unknown>;
    expect(profile.displayName).toBe("Ariel");
    expect(profile.email).toBe("a@example.com");
  });

  it("does not mutate the caller's nested objects", () => {
    // sanitizeForSync is handed the live Dexie record; deleting in place would
    // wipe the user's own key off their machine.
    const original = settings();
    sanitizeForSync("settings", original);
    expect(original.userProfile.kitApiKey).toBe("kit-live-secret");
    expect(original.userProfile.composioApiKey).toBe("comp-live-secret");
  });

  it("restores nested keys from the local row on the way down", () => {
    const incoming = sanitizeForSync("settings", settings());
    const local = settings();

    const merged = mergeFromSync("settings", incoming, local);
    const profile = merged.userProfile as Record<string, unknown>;

    expect(profile.kitApiKey).toBe("kit-live-secret");
    expect(profile.composioApiKey).toBe("comp-live-secret");
    expect(profile.linkedInConnectedAccountId).toBe("acct_123");
  });

  it("takes the remote value for non-credential profile fields", () => {
    const incoming = sanitizeForSync("settings", {
      ...settings(),
      userProfile: { ...settings().userProfile, displayName: "Renamed" },
    });

    const merged = mergeFromSync("settings", incoming, settings());
    expect((merged.userProfile as Record<string, unknown>).displayName).toBe("Renamed");
  });
});
