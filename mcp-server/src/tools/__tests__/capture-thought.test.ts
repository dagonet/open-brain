import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureThought } from '../capture-thought.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
});

describe('captureThought', () => {
  it('captures a thought successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: {
          id: 'abc-123',
          thought_type: 'insight',
          people: ['Alice'],
          topics: ['testing'],
        },
      }),
    });

    const result = JSON.parse(await captureThought({ text: 'Test insight' }));

    expect(result.success).toBe(true);
    expect(result.is_duplicate).toBe(false);
    expect(result.thought_id).toBe('abc-123');
    expect(result.thought_type).toBe('insight');
    expect(result.people).toEqual(['Alice']);
    expect(result.topics).toEqual(['testing']);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.source).toBe('mcp');
    expect(fetchBody.idempotency_key).toBeDefined();
  });

  it('sends project in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: { id: 'abc-123', thought_type: 'note', people: [], topics: [] },
      }),
    });

    await captureThought({ text: 'Project thought', project: 'open-brain' });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.project).toBe('open-brain');
  });

  it('omits project from request body when neither param nor ENV is set', async () => {
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', '');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: { id: 'abc-123', thought_type: 'note', people: [], topics: [] },
      }),
    });

    await captureThought({ text: 'No project' });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.project).toBeUndefined();
  });

  it('uses OPEN_BRAIN_DEFAULT_PROJECT when project param is omitted', async () => {
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', 'env-project');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: { id: 'abc-123', thought_type: 'note', people: [], topics: [] },
      }),
    });

    await captureThought({ text: 'Env scoped' });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.project).toBe('env-project');
  });

  it('explicit project overrides OPEN_BRAIN_DEFAULT_PROJECT', async () => {
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', 'env-project');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: { id: 'abc-123', thought_type: 'note', people: [], topics: [] },
      }),
    });

    await captureThought({ text: 'Explicit wins', project: 'explicit' });

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.project).toBe('explicit');
  });

  it('renders duplicate_candidate guidance when returned', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: false,
        thought: {
          id: 'new-id',
          thought_type: 'note',
          people: [],
          topics: [],
        },
        duplicate_candidate: {
          thought_id: 'existing-id',
          raw_text_preview: 'Existing thought...',
          similarity: 0.92,
        },
      }),
    });

    const result = JSON.parse(await captureThought({ text: 'Similar thought' }));

    expect(result.duplicate_candidate).toBeDefined();
    expect(result.duplicate_candidate.thought_id).toBe('existing-id');
    expect(result.duplicate_candidate.similarity).toBe(0.92);
    expect(result.note).toContain('Near-duplicate detected');
    expect(result.note).toContain('existing-id');
    expect(result.note).toContain('0.92');
    expect(result.note).toContain('thoughts_supersede');
  });

  it('returns is_duplicate when thought already exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        is_duplicate: true,
        thought: { id: 'existing-id', thought_type: 'note', people: [], topics: [] },
      }),
    });

    const result = JSON.parse(await captureThought({ text: 'Duplicate thought' }));

    expect(result.success).toBe(true);
    expect(result.is_duplicate).toBe(true);
  });

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const result = JSON.parse(await captureThought({ text: 'Will fail' }));

    expect(result.error).toBe('Internal server error');
  });

  it('returns graceful error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = JSON.parse(await captureThought({ text: 'No network' }));

    expect(result.error).toBe('Failed to capture thought');
    expect(result.message).toBe('Network unreachable');
  });

  it('produces deterministic idempotency keys', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, is_duplicate: false, thought: { id: '1' } }),
    });

    await captureThought({ text: 'Same thought' });
    await captureThought({ text: 'Same thought' });
    await captureThought({ text: 'Different thought' });

    const key1 = JSON.parse(mockFetch.mock.calls[0][1].body).idempotency_key;
    const key2 = JSON.parse(mockFetch.mock.calls[1][1].body).idempotency_key;
    const key3 = JSON.parse(mockFetch.mock.calls[2][1].body).idempotency_key;

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('returns error when env vars are missing', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const result = JSON.parse(await captureThought({ text: 'No env' }));

    expect(result.error).toBe('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
