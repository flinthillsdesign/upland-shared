import { test } from "node:test";
import assert from "node:assert";
import { withRetry, isTransientDbError } from "../src/db";

test("only connection errors count as transient", () => {
  assert.equal(isTransientDbError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientDbError({ cause: { code: "ETIMEDOUT" } }), true);
  assert.equal(isTransientDbError(new Error("socket hang up")), true);
  assert.equal(isTransientDbError(new Error("fetch failed")), true);
  assert.equal(isTransientDbError(new Error("SQLITE_CONSTRAINT: UNIQUE")), false);
  assert.equal(isTransientDbError(new Error("no such column: x")), false);
});

test("a dropped connection is retried once, with every argument", async () => {
  const seen: any[] = [];
  let n = 0;
  const client = withRetry(
    {
      execute: async (...args: any[]) => {
        seen.push(args);
        if (++n === 1) throw new Error("socket hang up");
        return { rows: [1] };
      },
      batch: async (...args: any[]) => {
        seen.push(args);
        return "batched";
      },
    },
    0,
  );
  assert.deepEqual(await client.execute("SELECT ?", [1]), { rows: [1] });
  assert.deepEqual(seen, [["SELECT ?", [1]], ["SELECT ?", [1]]]);
  // The copies this replaces passed only the first argument, dropping the mode.
  assert.equal(await client.batch!(["a", "b"], "write"), "batched");
  assert.deepEqual(seen[2], [["a", "b"], "write"]);
});

test("a real query error throws at once and is not run twice", async () => {
  let n = 0;
  const client = withRetry({ execute: async () => { n++; throw new Error("SQLITE_CONSTRAINT"); } }, 0);
  await assert.rejects(() => client.execute("INSERT"), /SQLITE_CONSTRAINT/);
  assert.equal(n, 1);
});

test("a second dropped connection is the caller's error", async () => {
  let n = 0;
  const client = withRetry({ execute: async () => { n++; throw new Error("ECONNRESET"); } }, 0);
  await assert.rejects(() => client.execute("SELECT 1"), /ECONNRESET/);
  assert.equal(n, 2);
});
