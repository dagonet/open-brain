// Entrypoint only: the handler lives in ./handler.ts so tests can import it without starting a server.
import { handler } from './handler.ts';

Deno.serve(handler);
