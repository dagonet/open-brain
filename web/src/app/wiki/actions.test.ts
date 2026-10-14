import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }));
const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn(),
};

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

const fetchMock = vi.fn();

describe('wiki actions input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('rejectWikiPage is a no-op when required fields are missing', async () => {
    const { rejectWikiPage } = await import('./actions');
    const form = new FormData();
    form.set('page_id', 'p1');
    // slug and reason missing

    await rejectWikiPage(form);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('refreshWikiPage is a no-op when slug is missing', async () => {
    const { refreshWikiPage } = await import('./actions');
    await refreshWikiPage(new FormData());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('resolveContradiction is a no-op for an unrecognized decision', async () => {
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'not-a-real-decision');

    await resolveContradiction(form);

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('resolveContradiction is a no-op when id is missing', async () => {
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('decision', 'resolved');

    await resolveContradiction(form);

    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

describe('refreshWikiPage auth', () => {
  const ANON = 'anon-key-value';
  const SERVICE = 'service-key-value';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function slugForm(): FormData {
    const form = new FormData();
    form.set('slug', 'topic-a');
    return form;
  }

  it('sends the server-only service-role key to compile-wiki when set', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    const { refreshWikiPage } = await import('./actions');

    await refreshWikiPage(slugForm());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/compile-wiki');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('falls back to the anon key and warns once (without printing a key) when unset', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { refreshWikiPage } = await import('./actions');

    await refreshWikiPage(slugForm());
    await refreshWikiPage(slugForm());

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers.Authorization).toBe(`Bearer ${ANON}`);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(msg).not.toContain(ANON);
  });
});
