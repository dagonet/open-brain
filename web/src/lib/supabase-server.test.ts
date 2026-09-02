import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CookieConfig {
  getAll: () => unknown;
  setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void;
}

let capturedCookieConfig: CookieConfig;

const mockCookieStore = {
  getAll: vi.fn(() => [{ name: 'sb-token', value: 'abc' }]),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, config: { cookies: CookieConfig }) => {
    capturedCookieConfig = config.cookies;
    return { client: true };
  }),
}));

describe('supabase-server createClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('getAll delegates to the request cookie store', async () => {
    const { createClient } = await import('./supabase-server');
    await createClient();

    expect(capturedCookieConfig.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
  });

  it('setAll writes each cookie to the store', async () => {
    const { createClient } = await import('./supabase-server');
    await createClient();

    capturedCookieConfig.setAll([{ name: 'sb-token', value: 'new', options: { path: '/' } }]);

    expect(mockCookieStore.set).toHaveBeenCalledWith('sb-token', 'new', { path: '/' });
  });

  it('setAll swallows errors thrown when called from a Server Component', async () => {
    mockCookieStore.set.mockImplementationOnce(() => {
      throw new Error('cannot set cookies in a Server Component');
    });

    const { createClient } = await import('./supabase-server');
    await createClient();

    expect(() =>
      capturedCookieConfig.setAll([{ name: 'sb-token', value: 'new', options: {} }]),
    ).not.toThrow();
  });
});
