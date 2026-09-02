import { describe, it, expect } from 'vitest';
import { buildHref } from './Pagination';

describe('buildHref', () => {
  it('returns "/" when no params remain after merge', () => {
    expect(buildHref({}, {})).toBe('/');
  });

  it('builds a query string from merged params', () => {
    expect(buildHref({ page: '1' }, { page: '2' })).toBe('/?page=2');
  });

  it('drops keys whose value is undefined or empty string', () => {
    const href = buildHref({ page: '2', q: 'hello' }, { cursor: undefined, cursor_id: '' });
    expect(href).toBe('/?page=2&q=hello');
  });

  it('overrides base params with override params of the same key', () => {
    expect(buildHref({ page: '1', q: 'x' }, { page: '3' })).toBe('/?page=3&q=x');
  });

  it('URL-encodes param values', () => {
    expect(buildHref({}, { q: 'a b&c' })).toBe('/?q=a%20b%26c');
  });
});
