// Pure SSE parsing for the AI concierge chat stream.
//
// The Worker (`worker/src/providers.ts`, `passthroughSSE`) forwards the upstream provider's raw
// SSE body UNCHANGED and does not tag which provider answered — so the client may receive
// EITHER shape depending on which leg of the Gemini -> Groq fallback ladder responded (see the
//'s judgment-call note, this was not spelled out in the brief):
// - Gemini (`alt=sse`, `streamGenerateContent`):
// `data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}`
// - Groq / OpenAI-compatible chat-completions stream:
// `data: {"choices":[{"delta":{"content":"..."}}]}`, terminated by `data: [DONE]`.
//
// Framework/transport-free ( pure-core convention, mirrors `lib/currency-rate.ts`'s
// `parseFrankfurter`): no fetch, no DOM, no React — trivially unit-testable, never throws.

/**
 * Incremental SSE frame accumulator. Feed raw chunk text (as decoded from the network) via
 * `push`; get back zero or more complete event `data` payloads as they close on the blank line
 * the SSE spec uses to terminate an event. Handles a `data:` payload split across chunk/line
 * boundaries and an event carrying multiple `data:` lines (joined with `\n` per spec).
 */
export class SSELineBuffer {
  private carry = '';
  private dataLines: string[] = [];

  push(chunk: string): string[] {
    this.carry += chunk;
    const lines = this.carry.split('\n');
    // The last split segment may be a partial line — hold it back for the next push.
    this.carry = lines.pop() ?? '';

    const events: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        if (this.dataLines.length > 0) {
          events.push(this.dataLines.join('\n'));
          this.dataLines = [];
        }
        continue;
      }
      if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      // Other SSE fields (event:/id:/retry:, or a leading `:` comment) are irrelevant to this
      // relay and are ignored, never treated as an error.
    }
    return events;
  }
}

/**
 * Extract the incremental assistant-text delta from one SSE event's joined `data` payload.
 * Returns `null` for the `[DONE]` sentinel, unparsable JSON, or any payload that carries no
 * recognizable text in either provider shape (never throws).
 */
export function extractDeltaText(eventData: string): string | null {
  const trimmed = eventData.trim();
  if (!trimmed || trimmed === '[DONE]') return null;

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;

  // Groq / OpenAI-compatible: choices[0].delta.content
  const openai = json as { choices?: Array<{ delta?: { content?: unknown } }> };
  const openaiText = openai.choices?.[0]?.delta?.content;
  if (typeof openaiText === 'string' && openaiText.length > 0) return openaiText;

  // Gemini: candidates[0].content.parts[].text (joined — a single chunk can carry >1 part)
  const gemini = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  const parts = gemini.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    if (text) return text;
  }

  return null;
}
