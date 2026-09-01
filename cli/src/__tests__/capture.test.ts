import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureSingleThought } from '../brain.js';

const FAKE_URL = 'https://test-project.supabase.co/functions/v1/capture-thought';
const FAKE_KEY = 'test-api-key';

describe('captureSingleThought', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleLogLines: string[];
  let consoleErrorLines: string[];

  beforeEach(() => {
    process.env.BRAIN_API_URL = FAKE_URL;
    process.env.BRAIN_API_KEY = FAKE_KEY;

    consoleLogLines = [];
    consoleErrorLines = [];

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogLines.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrorLines.push(args.join(' '));
    });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    delete process.env.BRAIN_API_URL;
    delete process.env.BRAIN_API_KEY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes project in the request body when --project is provided', async () => {
    let requestBody: unknown = null;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
      }),
    });

    await captureSingleThought('test thought', 'my-project');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    requestBody = JSON.parse(callArgs[1].body as string);
    expect(requestBody).toHaveProperty('project', 'my-project');
    expect(requestBody).toHaveProperty('text', 'test thought');
    expect(requestBody).toHaveProperty('source', 'cli');
  });

  it('does NOT include project in request body when not provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
      }),
    });

    await captureSingleThought('test thought');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body as string);
    expect(requestBody).not.toHaveProperty('project');
  });

  it('does NOT include project when --project is empty string', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
      }),
    });

    await captureSingleThought('test thought', '');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body as string);
    expect(requestBody).not.toHaveProperty('project');
  });

  it('prints duplicate_candidate hint when response contains one', async () => {
    const candidate = {
      thought_id: 'abc-123',
      raw_text_preview: 'This is a very similar thought that already exists in the system',
      similarity: 0.95,
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
        duplicate_candidate: candidate,
      }),
    });

    await captureSingleThought('test thought');

    const hintLine = consoleLogLines.find((l) => l.includes('Near-duplicate'));
    expect(hintLine).toBeDefined();
    expect(hintLine).toContain('abc-123');
    expect(hintLine).toContain('0.95');
    expect(hintLine).toContain('consider superseding');
  });

  it('does NOT print duplicate_candidate hint when absent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
      }),
    });

    await captureSingleThought('test thought');

    const hintLine = consoleLogLines.find((l) => l.includes('Near-duplicate'));
    expect(hintLine).toBeUndefined();
  });
});
