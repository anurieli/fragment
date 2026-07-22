/**
 * Secure credential storage backed by Tauri Stronghold (encrypted vault).
 *
 * In Tauri builds, API keys and tokens are stored in an Argon2-encrypted
 * Stronghold vault on disk instead of plain-text IndexedDB.
 *
 * In browser / dev-server builds the module is a no-op — credentials remain
 * in IndexedDB via the settings store (acceptable for local development).
 */

import { isTauri } from "./ai-client";
import type { ProviderCredentials } from "./types";

// ---------------------------------------------------------------------------
// Credential keys in the Stronghold store
// ---------------------------------------------------------------------------

const CREDENTIAL_KEYS: (keyof ProviderCredentials)[] = [
  "openRouterApiKey",
  "openAiApiKey",
  "anthropicApiKey",
  "perplexityApiKey",
  "codexAccessToken",
  "codexRefreshToken",
];

const VAULT_PASSWORD = "fragment-credential-vault-v1";
const CLIENT_NAME = "fragment";
const VAULT_FILENAME = "fragment.hold";

// ---------------------------------------------------------------------------
// Cached Stronghold instance (Argon2 derivation is intentionally slow)
// ---------------------------------------------------------------------------

interface StrongholdStore {
  get(key: string): Promise<Uint8Array | null>;
  insert(key: string, value: number[]): Promise<void>;
  remove(key: string): Promise<Uint8Array | null>;
}

interface StrongholdHandle {
  store: StrongholdStore;
  save(): Promise<void>;
}

let cachedHandle: StrongholdHandle | null = null;
let handlePromise: Promise<StrongholdHandle | null> | null = null;

/** True in Tauri dev mode (HMR). Stronghold's Argon2 init is too slow for
 *  frequent reloads and causes stale-callback freezes. Credentials stay in
 *  IndexedDB during development — acceptable for local work. */
function isTauriDev(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  );
}

async function getHandle(): Promise<StrongholdHandle | null> {
  if (!isTauri()) return null;
  // Skip Stronghold in dev mode to avoid stale-callback freezes during HMR
  if (isTauriDev()) return null;
  if (cachedHandle) return cachedHandle;
  if (handlePromise) return handlePromise;

  handlePromise = (async () => {
    try {
      const { appLocalDataDir } = await import("@tauri-apps/api/path");
      const { Stronghold } = await import("@tauri-apps/plugin-stronghold");

      const dir = await appLocalDataDir();
      const vaultPath = `${dir}${VAULT_FILENAME}`;

      const stronghold = await Stronghold.load(vaultPath, VAULT_PASSWORD);

      let client: Awaited<ReturnType<typeof stronghold.loadClient>>;
      try {
        client = await stronghold.loadClient(CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(CLIENT_NAME);
      }

      const store = client.getStore();
      cachedHandle = {
        store,
        save: () => stronghold.save(),
      };
      return cachedHandle;
    } catch {
      // Stronghold not available (e.g. running in browser despite isTauri check)
      return null;
    }
  })();

  const result = await handlePromise;
  handlePromise = null;
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load all credentials from the Stronghold vault. Returns null in non-Tauri. */
export async function loadSecureCredentials(): Promise<ProviderCredentials | null> {
  const handle = await getHandle();
  if (!handle) return null;

  const result: Record<string, string> = {};
  for (const key of CREDENTIAL_KEYS) {
    const data = await handle.store.get(key);
    result[key] = data ? new TextDecoder().decode(new Uint8Array(data)) : "";
  }
  return result as unknown as ProviderCredentials;
}

/**
 * Persist credentials to the Stronghold vault.
 * Only writes keys that have changed. Strips empty values (removes from vault).
 * Returns true if Stronghold actually saved, false if unavailable.
 */
export async function saveSecureCredentials(
  credentials: Partial<ProviderCredentials>,
): Promise<boolean> {
  const handle = await getHandle();
  if (!handle) return false;

  for (const key of CREDENTIAL_KEYS) {
    if (!(key in credentials)) continue;
    const value = credentials[key] ?? "";
    if (value) {
      const encoded = Array.from(new TextEncoder().encode(value));
      await handle.store.insert(key, encoded);
    } else {
      try {
        await handle.store.remove(key);
      } catch {
        // Key may not exist yet — safe to ignore
      }
    }
  }
  await handle.save();
  return true;
}

/** Remove all credentials from the vault. */
export async function clearSecureCredentials(): Promise<void> {
  const handle = await getHandle();
  if (!handle) return;

  for (const key of CREDENTIAL_KEYS) {
    try {
      await handle.store.remove(key);
    } catch {
      // Key may not exist
    }
  }
  await handle.save();
}

/** Strip credential values from a settings object (returns a copy).
 *  Only strips when Stronghold is actually available — in Tauri dev mode
 *  (localhost) Stronghold is bypassed, so credentials must remain in
 *  IndexedDB/localStorage to survive reloads. */
export function stripCredentials<T extends { providerCredentials?: ProviderCredentials }>(
  settings: T,
): T {
  if (!isTauri() || isTauriDev() || !settings.providerCredentials) return settings;
  const emptied = Object.fromEntries(
    CREDENTIAL_KEYS.map((key) => [key, ""]),
  ) as unknown as ProviderCredentials;
  return {
    ...settings,
    providerCredentials: emptied,
  };
}
