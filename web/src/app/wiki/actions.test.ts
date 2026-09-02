import { describe, it, expect, vi, beforeEach } from 'vitest';

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
