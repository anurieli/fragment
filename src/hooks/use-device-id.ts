import { nanoid } from "nanoid";

const STORAGE_KEY = "fragment:deviceId";

let cached: string | null = null;

export function useDeviceId(): string {
  if (cached) return cached;

  if (typeof window === "undefined") return "";

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    cached = stored;
    return cached;
  }

  const id = nanoid(21);
  localStorage.setItem(STORAGE_KEY, id);
  cached = id;
  return cached;
}
