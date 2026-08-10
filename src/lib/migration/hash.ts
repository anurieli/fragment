/**
 * A stable content fingerprint for migration verification.
 *
 * The verification gate has to answer one question about tens of thousands of
 * characters: did this text survive the move byte for byte? Comparing the
 * strings themselves would work, but it means holding two full copies of the
 * library in memory at once. A hash lets the gate keep one small value per
 * record instead.
 *
 * FNV-1a over UTF-16 code units, run as two independent 32-bit lanes and
 * concatenated. Synchronous on purpose: crypto.subtle is async, and the gate
 * runs inside a Dexie upgrade transaction, where an await on anything other
 * than the transaction's own promises silently commits it early.
 *
 * This is not a security primitive. It detects accidental corruption and
 * truncation, which is all the gate is for. Never use it where an adversary
 * chooses the input.
 */

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_PRIME_A = 0x01000193;
const FNV_OFFSET_B = 0x84222325;
const FNV_PRIME_B = 0x000001b3;

/** Lowercase hex, always 16 characters. */
export function contentHash(input: string): string {
  let a = FNV_OFFSET_A;
  let b = FNV_OFFSET_B;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, FNV_PRIME_A);
    // The second lane folds in the position as well, so that a transposition
    // ("ab" becoming "ba") changes the digest. A single FNV lane would not.
    b = Math.imul(b ^ (code + i), FNV_PRIME_B);
  }

  return toHex(a >>> 0) + toHex(b >>> 0);
}

function toHex(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * Hash a field that may be absent.
 *
 * undefined and the empty string are genuinely different states for Note
 * fields: `subtitle` undefined means "this note predates subtitles", while ""
 * means "the writer cleared it". The migration preserves that distinction, so
 * the gate has to be able to see it.
 */
export function optionalHash(value: string | null | undefined): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  return contentHash(value);
}
