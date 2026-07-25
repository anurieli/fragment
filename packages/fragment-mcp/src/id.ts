import { customAlphabet } from "nanoid";

// Lowercase base36 alphabet keeps ids filesystem- and URL-safe (they become
// directory and file names under the inbox tree).
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(ALPHABET, 12);

export function generateIdeaId(): string {
  return `idea_${nano()}`;
}

export function generatePieceId(): string {
  return `pc_${nano()}`;
}
