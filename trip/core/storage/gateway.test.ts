import { beforeEach, describe, expect, it } from 'vitest';
import { readJson } from './gateway';

describe('readJson', () => {
  beforeEach(() => localStorage.clear());

  it('returns the object fallback when stored JSON is an array', () => {
    localStorage.setItem('stored-object', '[]');

    expect(readJson('local', 'stored-object', { value: 'fallback' })).toEqual({ value: 'fallback' });
  });
});
