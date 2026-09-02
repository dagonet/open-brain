import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockGetUser: ReturnType<typeof vi.fn>;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

function makeRequest(pathname: string) {
  const nextUrl = new URL(`https://example.com${pathname}`) as URL & { clone: () => URL };
  nextUrl.clone = () => new URL(nextUrl.href);
  return {
    cookies: { getAll: () => [], set: vi.fn() },
    nextUrl,
  } as unknown as import('next/server').NextRequest;
}

describe('middleware', () => {
  beforeEach(() => {
    mockGetUser = vi.fn(async () => ({ data: { user: null } }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('allows /login through without checking auth redirect', async () => {
    const { middleware } = await import('./middleware');
    const res = await middleware(makeRequest('/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows /auth/callback through', async () => {
    const { middleware } = await import('./middleware');
    const res = await middleware(makeRequest('/auth/callback'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects to /login when there is no authenticated user', async () => {
    const { middleware } = await import('./middleware');
    const res = await middleware(makeRequest('/wiki'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('passes requests through when a user is authenticated', async () => {
    mockGetUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }));
    const { middleware } = await import('./middleware');
    const res = await middleware(makeRequest('/wiki'));
    expect(res.headers.get('location')).toBeNull();
  });
});
