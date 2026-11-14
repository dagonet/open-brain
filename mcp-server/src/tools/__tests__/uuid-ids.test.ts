import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { definition as deleteDef } from '../delete-thought.js';
import { definition as getDef } from '../task-get.js';

// zod 4's z.string().uuid() enforces RFC variants; the tools accept any UUID-shaped id
// (z.guid()), as they did on zod 3.
const NON_RFC_ID = 'a0000000-0000-0000-0000-000000000001';

describe('id parameters accept non-RFC-variant UUIDs', () => {
  it.each([
    ['thoughts_delete', deleteDef],
    ['task_get', getDef],
  ])('%s', (_name, def) => {
    expect(z.object(def.schema).parse({ id: NON_RFC_ID })).toMatchObject({ id: NON_RFC_ID });
  });

  it('still rejects a value that is not UUID-shaped', () => {
    expect(() => z.object(deleteDef.schema).parse({ id: 'not-a-uuid' })).toThrow();
  });
});
