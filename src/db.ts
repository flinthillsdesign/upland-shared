// ── One retry for a dropped database connection ──────────────────────────
// Turso's HTTP edge now and then drops a connection mid-flight (ECONNRESET,
// "socket hang up") for a minute or two; without a retry every request in
// that window fails. Three apps each had a copy of this wrapper, and two of
// the copies passed only the first argument through, dropping a batch's
// mode. This is the one.
//
// Only connection errors retry. A real query error (bad SQL, a constraint,
// a refused token) throws on the first try so nothing runs twice by mistake.

const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]);
const TRANSIENT_PATTERN = /socket hang up|ECONNRESET|fetch failed/i;

export function isTransientDbError(err: any): boolean {
  const code = err?.code || err?.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  return TRANSIENT_PATTERN.test(String(err?.message || err || ""));
}

async function retryOnce<T>(label: string, fn: () => Promise<T>, pauseMs: number): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (!isTransientDbError(err)) throw err;
    console.warn(`[db-retry] transient error on ${label}: ${err?.message || err} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    return fn();
  }
}

// Wraps an @libsql/client instance in place: execute and batch retry once on
// a dropped connection, every argument passed through. Returns the client.
export function withRetry<T extends { execute: Function; batch?: Function }>(
  client: T,
  pauseMs = 100,
): T {
  const origExecute = client.execute.bind(client);
  client.execute = ((...args: any[]) =>
    retryOnce("execute", () => origExecute(...args), pauseMs)) as any;
  if (typeof client.batch === "function") {
    const origBatch = client.batch.bind(client);
    client.batch = ((...args: any[]) =>
      retryOnce("batch", () => origBatch(...args), pauseMs)) as any;
  }
  return client;
}
