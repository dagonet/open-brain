"use server";

// Re-export of the contradictions resolve action so /contradictions routes
// can import it from a co-located actions file.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44

export { resolveContradiction } from "../wiki/actions";
