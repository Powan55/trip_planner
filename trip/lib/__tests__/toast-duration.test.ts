import { describe, expect, it } from 'vitest';
import { readMs } from '@/lib/toast-duration';

describe('readMs', () => {
  it('floors short messages at 5s', () => {
    expect(readMs('Could not copy')).toBe(5000);
  });
  it('scales at 400ms a word', () => {
    expect(readMs(Array(20).fill('word').join(' '))).toBe(8000);
  });
  it('caps long messages at 12s', () => {
    expect(readMs(Array(60).fill('word').join(' '))).toBe(12000);
  });
});
