import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revalidatePath } from 'next/cache';

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

const mockGetUser = vi.fn(async () => ({ data: { user: { id: OWNER } } }));
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

// The chain resolveContradiction runs: from().update().eq().select(), which
// resolves with the rows the update touched.
type UpdateResult = { data: { id: string }[] | null; error: { message: string } | null };
function updateChain(result: UpdateResult) {
  return { update: () => ({ eq: () => ({ select: async () => result }) }) };
}

describe('wiki actions input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: OWNER } } });
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
    mockGetUser.mockResolvedValue({ data: { user: { id: OWNER } } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    vi.stubEnv('OWNER_USER_IDS', OWNER);
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

describe('capture-thought calls auth', () => {
  const ANON = 'anon-key-value';
  const SERVICE = 'service-key-value';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: OWNER } } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    vi.stubEnv('OWNER_USER_IDS', OWNER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejectWikiPage sends the server-only service-role key to capture-thought', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    const { rejectWikiPage } = await import('./actions');
    const form = new FormData();
    form.set('page_id', 'p1');
    form.set('slug', 'topic-a');
    form.set('reason', 'too long');

    await rejectWikiPage(form);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/capture-thought');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('resolveContradiction sends the service-role key to capture-thought for the audit thought', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    mockSupabase.from.mockReturnValue(updateChain({ data: [{ id: 'c1' }], error: null }));
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'resolved');
    form.set('note', 'B supersedes A');

    await resolveContradiction(form);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/capture-thought');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('resolveContradiction surfaces a failed audit-note capture', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    mockSupabase.from.mockReturnValue(updateChain({ data: [{ id: 'c1' }], error: null }));
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'resolved');
    form.set('note', 'B supersedes A');

    await expect(resolveContradiction(form)).rejects.toThrow(/audit note failed: HTTP 401/);
    expect(revalidatePath).toHaveBeenCalledWith('/contradictions');
    expect(revalidatePath).toHaveBeenCalledWith('/contradictions/c1');
  });

  it('resolveContradiction throws before writing the audit note when no row was updated', async () => {
    // RLS hides the row from an account that is not in public.owners: the update
    // matches zero rows and PostgREST reports no error.
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    mockSupabase.from.mockReturnValue(updateChain({ data: [], error: null }));
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'resolved');
    form.set('note', 'B supersedes A');

    await expect(resolveContradiction(form)).rejects.toThrow(/no row was updated/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('resolveContradiction surfaces a database error from the update', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    mockSupabase.from.mockReturnValue(updateChain({ data: null, error: { message: 'boom' } }));
    const { resolveContradiction } = await import('./actions');
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'resolved');
    form.set('note', 'B supersedes A');

    await expect(resolveContradiction(form)).rejects.toThrow(
      /Failed to resolve contradiction: boom/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('owner-only guard', () => {
  // Terminal call of the update chain (.select()); counts resolve updates.
  const updateMock = vi.fn(async () => ({ data: [{ id: 'c1' }], error: null }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: OWNER } } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-value');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-value');
    mockSupabase.from.mockReturnValue({
      update: () => ({ eq: () => ({ select: updateMock }) }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function rejectForm(): FormData {
    const form = new FormData();
    form.set('page_id', 'p1');
    form.set('slug', 'topic-a');
    form.set('reason', 'too long');
    return form;
  }
  function refreshForm(): FormData {
    const form = new FormData();
    form.set('slug', 'topic-a');
    return form;
  }
  function resolveForm(): FormData {
    const form = new FormData();
    form.set('id', 'c1');
    form.set('decision', 'resolved');
    form.set('note', 'B supersedes A');
    return form;
  }

  const actions = [
    ['rejectWikiPage', rejectForm],
    ['refreshWikiPage', refreshForm],
    ['resolveContradiction', resolveForm],
  ] as const;

  function expectNothingCalled() {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  }

  describe.each(actions)('%s', (name, makeForm) => {
    async function run(): Promise<void> {
      const mod = (await import('./actions')) as unknown as Record<
        string,
        (f: FormData) => Promise<void>
      >;
      return mod[name](makeForm());
    }

    it('allows a listed owner', async () => {
      vi.stubEnv('OWNER_USER_IDS', OWNER);
      await expect(run()).resolves.toBeUndefined();
      if (name === 'resolveContradiction') {
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1); // audit note
      } else {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(updateMock).not.toHaveBeenCalled();
      }
    });

    it('denies a logged-in user who is not listed', async () => {
      vi.stubEnv('OWNER_USER_IDS', OWNER);
      mockGetUser.mockResolvedValue({ data: { user: { id: OTHER } } });
      await expect(run()).rejects.toThrow(/not allowed/);
      expectNothingCalled();
    });

    it('denies when OWNER_USER_IDS is unset', async () => {
      vi.stubEnv('OWNER_USER_IDS', undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(run()).rejects.toThrow(/OWNER_USER_IDS is not configured/);
      expectNothingCalled();
    });

    it('denies when OWNER_USER_IDS is empty or only separators', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const value of ['', '  ', ' , ,']) {
        vi.stubEnv('OWNER_USER_IDS', value);
        await expect(run()).rejects.toThrow(/OWNER_USER_IDS is not configured/);
      }
      expectNothingCalled();
    });

    it('redirects to /login with no user, before any call', async () => {
      vi.stubEnv('OWNER_USER_IDS', OWNER);
      mockGetUser.mockResolvedValue({ data: { user: null } } as never);
      await expect(run()).rejects.toThrow('NEXT_REDIRECT');
      expectNothingCalled();
    });
  });

  describe('list parsing', () => {
    it('accepts any of several ids', async () => {
      vi.stubEnv('OWNER_USER_IDS', `${OTHER},${OWNER}`);
      const { refreshWikiPage } = await import('./actions');
      await refreshWikiPage(refreshForm());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('tolerates spaces around commas and empty entries', async () => {
      vi.stubEnv('OWNER_USER_IDS', ` ,  ${OTHER} ,  ${OWNER}  ,, `);
      const { refreshWikiPage } = await import('./actions');
      await refreshWikiPage(refreshForm());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['strict prefix', OWNER.slice(0, -1)],
      ['strict inner substring', OWNER.slice(1, -1)],
      ['strict suffix', OWNER.slice(1)],
    ])('denies when the listed entry is a %s of the user id', async (_label, listed) => {
      vi.stubEnv('OWNER_USER_IDS', listed);
      const { refreshWikiPage } = await import('./actions');
      await expect(refreshWikiPage(refreshForm())).rejects.toThrow(/not allowed/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not match on a substring of a listed id', async () => {
      vi.stubEnv('OWNER_USER_IDS', `${OWNER}-extra`);
      const { refreshWikiPage } = await import('./actions');
      await expect(refreshWikiPage(refreshForm())).rejects.toThrow(/not allowed/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('warns once when unset, without logging user ids', async () => {
    vi.stubEnv('OWNER_USER_IDS', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { refreshWikiPage } = await import('./actions');
    await expect(refreshWikiPage(refreshForm())).rejects.toThrow();
    await expect(refreshWikiPage(refreshForm())).rejects.toThrow();
    const ownerWarns = warn.mock.calls.filter((c) => String(c[0]).includes('OWNER_USER_IDS'));
    expect(ownerWarns).toHaveLength(1);
    expect(String(ownerWarns[0][0])).not.toContain(OWNER);
  });
});
