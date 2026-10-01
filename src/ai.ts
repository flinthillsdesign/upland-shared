// ── One way to call Claude ───────────────────────────────────────────────
// ODIN grew a wrapper around the Anthropic client that knows the things a
// bare call gets wrong on Claude 5 models. The other apps called the SDK
// directly and had none of it: a reply cut off at max_tokens was parsed as if
// whole (Agreements showed people raw partial JSON), a forced tool call would
// fail outright on Opus 5.5, and a transient 529 failed the request. This is
// ODIN's wrapper, moved here so there is one.
//
// What it does, on every call:
//   - adds `output_config: { effort }` on models that take it, and drops it
//     and retries if the API says the request can't carry it;
//   - relaxes a forced `tool_choice` to `auto` on models that reject forcing
//     (Opus 5.5), and asks once more if the tool wasn't called;
//   - turns on server-side fallbacks on Opus 5.5, so a classifier refusal of
//     a benign request is re-run instead of returned empty;
//   - reports a reply cut off at max_tokens (onTruncated) — with thinking on,
//     max_tokens covers thinking + answer, so a cap that used to be generous
//     starts chopping answers silently;
//   - retries 500/502/503/529 with backoff (callWithRetry).
//
// No dependency: the app passes its own @anthropic-ai/sdk client in.
// Reading a reply: firstText() — never content[0].text, which is a thinking
// block when thinking is on.

export type Effort = "low" | "medium" | "high";

export interface AiOptions {
  // An @anthropic-ai/sdk client (`new Anthropic({ apiKey })`).
  anthropic: any;
  // Default effort for models that take output_config. Callers can pass
  // their own `output_config`, or `output_config: null` to send none.
  effort?: Effort;
  // Called after every successful request with the model and its usage.
  onUsage?: (model: string, usage: any) => void;
  // Called when a reply stopped at max_tokens. Default: a console warning.
  onTruncated?: (opts: any, response: any) => void;
  // For tests.
  wait?: (ms: number) => Promise<void>;
}

export interface Ai {
  // One request, with the fixes above. Throws what the SDK throws.
  create: (opts: any, requestOpts?: any) => Promise<any>;
  // create(), retried on transient upstream failures.
  callWithRetry: (opts: any, requestOpts?: any) => Promise<any>;
}

// `output_config.effort` is a Claude 5 feature that older models reject
// outright (400). A coarse pre-filter, NOT proof a request will be accepted:
// model id alone doesn't decide it. callWithRetry's effort-rejection retry is
// the backstop — it believes the API instead of this pattern.
export function supportsEffort(model: any): boolean {
  return /claude-(opus|sonnet|fable)-5/.test(String(model || ""));
}

// Models that 400 on forced tool use (`tool_choice` "tool" / "any").
export function rejectsForcedTools(model: any): boolean {
  return /claude-(opus-5-5|fable-5-1|mythos-5-1)/.test(String(model || ""));
}

// Opt-out sentinel: `output_config: null` drops the field from the request
// entirely. Spreading `{}` over the default is NOT the same and does not
// work — it still puts an `output_config` key on the wire, so a request
// rejecting the parameter itself 400s exactly as before.
function applyOutputConfig(opts: any, effort: Effort): any {
  if (opts && "output_config" in opts) {
    if (opts.output_config !== null) return opts; // caller's own value wins
    const without = { ...opts };
    delete without.output_config;
    return without;
  }
  return supportsEffort(opts?.model) ? { output_config: { effort }, ...opts } : opts;
}

// Callers keep writing the forced form — it states intent — and it is
// relaxed here to `auto`. Returns the tool that must be called ("*" = any).
function relaxForcedTool(opts: any): { opts: any; required: string | null } {
  const tc = opts?.tool_choice;
  if (!tc || (tc.type !== "tool" && tc.type !== "any") || !rejectsForcedTools(opts.model))
    return { opts, required: null };
  return {
    opts: { ...opts, tool_choice: { type: "auto" } },
    required: tc.type === "tool" ? tc.name : "*",
  };
}

function calledTool(response: any, name: string): boolean {
  return (response?.content || []).some(
    (b: any) => b?.type === "tool_use" && (name === "*" || b.name === name),
  );
}

// Opus 5.5's safety classifiers can decline a benign request with
// stop_reason "refusal". Server-side fallbacks re-run it on the model
// Anthropic picks for that category instead of returning nothing.
function withFallbacks(opts: any): any {
  if (!/claude-opus-5-5/.test(String(opts?.model || ""))) return opts;
  return { ...opts, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

// The reply's text. With thinking on, content[0] is a thinking block —
// never read content[0].text directly.
export function firstText(response: any): string {
  if (!Array.isArray(response?.content)) return "";
  return response.content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

// The reply stopped at the cap: whatever came back is cut off.
export function wasTruncated(response: any): boolean {
  return response?.stop_reason === "max_tokens";
}

// The model declined to answer.
export function wasRefused(response: any): boolean {
  return response?.stop_reason === "refusal";
}

// The input of the first call to a tool, or null if it wasn't called.
export function toolInput(response: any, name: string): any {
  const b = (response?.content || []).find((x: any) => x?.type === "tool_use" && x.name === name);
  return b ? b.input : null;
}

// The API's own verdict that this request can't carry output_config.
function isEffortRejection(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status !== 400) return false;
  const msg = String(err?.message || err?.error?.error?.message || "");
  return /effort|output_config/i.test(msg);
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 529]);
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

export function createAi(options: AiOptions): Ai {
  const effort: Effort = options.effort || "low";
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const onTruncated =
    options.onTruncated ??
    ((opts: any, response: any) =>
      console.warn(
        `Anthropic response hit max_tokens=${opts?.max_tokens} (${response?.usage?.output_tokens ?? "?"} output tokens) — the answer is cut off`,
      ));

  const create = async (opts: any, requestOpts?: any) => {
    const send = async (o: any) => {
      const r = await options.anthropic.beta.messages.create(
        withFallbacks(applyOutputConfig(o, effort)),
        requestOpts,
      );
      if (options.onUsage && r?.usage) options.onUsage(String(o?.model || ""), r.usage);
      // Every call lands here, so this is the one place that sees a cap hit
      // however the caller pulls its text back out.
      if (wasTruncated(r)) onTruncated(o, r);
      return r;
    };
    const { opts: relaxed, required } = relaxForcedTool(opts);
    const response = await send(relaxed);
    if (!required || calledTool(response, required)) return response;
    if (wasTruncated(response) || wasRefused(response)) return response;
    // `auto` doesn't guarantee the call. Ask once more, append-only, so the
    // first turn's thinking blocks stay valid.
    const name = required === "*" ? "one of your tools" : `the ${required} tool`;
    return send({
      ...relaxed,
      messages: [
        ...relaxed.messages,
        { role: "assistant", content: response.content },
        { role: "user", content: `Call ${name} now with your answer.` },
      ],
    });
  };

  // Bounded retries on transient upstream failures. Anthropic occasionally
  // returns 500/502/503/529; without a retry one blip fails the request.
  const callWithRetry = async (createOpts: any, requestOpts?: any) => {
    let lastErr: any;
    let opts = createOpts;
    let droppedEffort = false;
    let attempt = 0;
    while (attempt < RETRY_BACKOFF_MS.length) {
      try {
        return await create(opts, requestOpts);
      } catch (err: any) {
        lastErr = err;
        // Retry once without output_config rather than losing the call. Not
        // latched: one rejecting request must not turn the effort default off
        // for every other caller. A deliberate rejection, not a blip, so it
        // retries at once and doesn't spend a backoff attempt.
        if (!droppedEffort && isEffortRejection(err)) {
          droppedEffort = true;
          opts = { ...opts, output_config: null };
          continue;
        }
        const status = err?.status ?? err?.response?.status;
        attempt++;
        if (attempt >= RETRY_BACKOFF_MS.length || !RETRYABLE_STATUSES.has(status)) throw err;
        await wait(RETRY_BACKOFF_MS[attempt - 1]);
      }
    }
    throw lastErr;
  };

  return { create, callWithRetry };
}
