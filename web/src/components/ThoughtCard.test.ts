import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { relativeTime } from './ThoughtCard';

describe('relativeTime', () => {
  const NOW = new Date('2026-01-15T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for under a minute', () => {
    const t = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(relativeTime(t)).toBe('just now');
  });

  it('returns "just now" at the 59s boundary', () => {
    const t = new Date(NOW.getTime() - 59 * 1000).toISOString();
    expect(relativeTime(t)).toBe('just now');
  });

  it('switches to minutes at exactly 60s', () => {
    const t = new Date(NOW.getTime() - 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('1m ago');
  });

  it('returns minutes under an hour', () => {
    const t = new Date(NOW.getTime() - 45 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('45m ago');
  });

  it('switches to hours at exactly 60 minutes', () => {
    const t = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('1h ago');
  });

  it('returns hours under a day', () => {
    const t = new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('5h ago');
  });

  it('switches to days at exactly 24 hours', () => {
    const t = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('1d ago');
  });

  it('returns days under 30 days', () => {
    const t = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('29d ago');
  });

  it('falls back to a locale date string at 30 days and beyond', () => {
    const then = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(relativeTime(then.toISOString())).toBe(then.toLocaleDateString());
  });
});
