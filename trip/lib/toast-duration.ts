/** How long an undo toast (and its progress ring) stays up. */
export const UNDO_MS = 7000;

/** Reading time for an error or instruction toast: 400ms a word, kept between 5s and 12s. */
export function readMs(message: string): number {
  const words = message.trim().split(/\s+/).length;
  return Math.min(12000, Math.max(5000, words * 400));
}
