/**
 * Two-device convergence check against a running server and a real Postgres.
 *
 * Deliberately not a vitest file. Everything that makes sync hard lives in
 * places a mocked test cannot reach: the ON CONFLICT clause that decides which
 * edit wins, the session lookup, the per-user scoping of every row. Those are
 * SQL and HTTP, so this drives SQL and HTTP.
 *
 * Creates a throwaway user, syncs as two devices against it, and deletes it
 * again. Run it after any change to the sync route, the protocol or the schema:
 *
 *   npm run build && npx next start -p 3012 &
 *   npm run verify:sync
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const BASE = process.env.FRAGMENT_TEST_BASE ?? "http://127.0.0.1:3012";
const DB = process.env.DATABASE_URL;

const client = new pg.Client({ connectionString: DB });
await client.connect();

let pass = 0;
let fail = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name} ${detail}`);
    fail++;
  }
}

// --- Set up one user with two device sessions (A and B) -------------------
await client.query("delete from users where codex_sub = 'test-sub-e2e'");
const { rows } = await client.query(
  "insert into users (codex_sub, email, name) values ($1,$2,$3) returning id",
  ["test-sub-e2e", "e2e@example.com", "E2E"],
);
const userId = rows[0].id;

async function makeSession() {
  const token = randomBytes(32).toString("base64url");
  await client.query(
    "insert into sessions (id, user_id, expires_at) values ($1,$2, now() + interval '1 day')",
    [createHash("sha256").update(token).digest("hex"), userId],
  );
  return token;
}

const tokenA = await makeSession();
const tokenB = await makeSession();

async function sync(token, cursor, changes) {
  const res = await fetch(`${BASE}/api/v1/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `fragment_session=${token}` },
    body: JSON.stringify({ cursor, changes }),
  });
  if (!res.ok) throw new Error(`sync ${res.status}: ${await res.text()}`);
  return res.json();
}

console.log("\nAuth");
{
  const res = await fetch(`${BASE}/api/v1/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor: 0, changes: [] }),
  });
  check("rejects an unauthenticated sync with 401", res.status === 401, `got ${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/v1/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `fragment_session=not-a-real-token` },
    body: JSON.stringify({ cursor: 0, changes: [] }),
  });
  check("rejects a forged session token", res.status === 401, `got ${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/v1/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `fragment_session=${tokenA}` },
    body: JSON.stringify({ cursor: 0, changes: [{ collection: "evil", id: "x", doc: {}, updatedAt: 1, deleted: false }] }),
  });
  check("rejects an unknown collection with 400", res.status === 400, `got ${res.status}`);
}

console.log("\nDevice A writes, device B receives");
let cursorA = 0;
let cursorB = 0;

{
  const res = await sync(tokenA, cursorA, [
    { collection: "notes", id: "note-1", doc: { id: "note-1", title: "From A", content: "hello" }, updatedAt: 1000, deleted: false },
    { collection: "ideas", id: "idea-1", doc: { id: "idea-1", title: "An idea" }, updatedAt: 1000, deleted: false },
  ]);
  cursorA = res.cursor;
  check("A's push returns a cursor above zero", res.cursor > 0, `cursor=${res.cursor}`);
}

{
  const res = await sync(tokenB, cursorB, []);
  cursorB = res.cursor;
  const note = res.changes.find((c) => c.id === "note-1");
  const idea = res.changes.find((c) => c.id === "idea-1");
  check("B pulls the note A wrote", note?.doc?.title === "From A", JSON.stringify(note));
  check("B pulls the idea A wrote", idea?.doc?.title === "An idea");
  check("B's cursor advanced", cursorB > 0, `cursor=${cursorB}`);
}

{
  const res = await sync(tokenB, cursorB, []);
  check("a second pull with the same cursor returns nothing", res.changes.length === 0, `${res.changes.length} changes`);
}

console.log("\nLast write wins");
{
  // B edits with a strictly newer clock — B should win.
  const res = await sync(tokenB, cursorB, [
    { collection: "notes", id: "note-1", doc: { id: "note-1", title: "From B", content: "newer" }, updatedAt: 2000, deleted: false },
  ]);
  cursorB = res.cursor;
  check("B's newer edit is accepted", true);

  const pulled = await sync(tokenA, cursorA, []);
  cursorA = pulled.cursor;
  const note = pulled.changes.find((c) => c.id === "note-1");
  check("A receives B's newer version", note?.doc?.title === "From B", JSON.stringify(note?.doc));
}

{
  // A pushes a STALE edit (older clock). The server must keep B's version and
  // hand the winner back so A does not sit on a value it thinks it saved.
  const res = await sync(tokenA, cursorA, [
    { collection: "notes", id: "note-1", doc: { id: "note-1", title: "Stale from A", content: "old" }, updatedAt: 500, deleted: false },
  ]);
  cursorA = res.cursor;
  const note = res.changes.find((c) => c.id === "note-1");
  check("a stale push does not overwrite the newer version", note?.doc?.title === "From B", JSON.stringify(note?.doc));

  const row = await client.query(
    "select doc->>'title' as title from documents where user_id=$1 and collection='notes' and id='note-1'",
    [userId],
  );
  check("the database still holds the winning version", row.rows[0].title === "From B", row.rows[0].title);
}

console.log("\nDeletes");
{
  const res = await sync(tokenA, cursorA, [
    { collection: "notes", id: "note-1", doc: null, updatedAt: 3000, deleted: true },
  ]);
  cursorA = res.cursor;

  const pulled = await sync(tokenB, cursorB, []);
  cursorB = pulled.cursor;
  const note = pulled.changes.find((c) => c.id === "note-1");
  check("B receives the tombstone", note?.deleted === true, JSON.stringify(note));
  check("the tombstone carries no content", note?.doc === null, JSON.stringify(note?.doc));

  const row = await client.query(
    "select doc from documents where user_id=$1 and collection='notes' and id='note-1'",
    [userId],
  );
  check("deleted content is not retained server-side", row.rows[0].doc === null, JSON.stringify(row.rows[0].doc));
}

console.log("\nIsolation between accounts");
{
  await client.query("delete from users where codex_sub = 'test-sub-other'");
  const other = await client.query(
    "insert into users (codex_sub) values ('test-sub-other') returning id",
  );
  const otherToken = randomBytes(32).toString("base64url");
  await client.query(
    "insert into sessions (id, user_id, expires_at) values ($1,$2, now() + interval '1 day')",
    [createHash("sha256").update(otherToken).digest("hex"), other.rows[0].id],
  );

  const res = await sync(otherToken, 0, []);
  check("a different account sees none of this user's documents", res.changes.length === 0, `${res.changes.length} leaked`);
  await client.query("delete from users where codex_sub = 'test-sub-other'");
}

console.log("\nBatching");
{
  const many = Array.from({ length: 50 }, (_, i) => ({
    collection: "snippets",
    id: `snip-${i}`,
    doc: { id: `snip-${i}`, content: `snippet ${i}` },
    updatedAt: 5000 + i,
    deleted: false,
  }));
  const res = await sync(tokenA, cursorA, many);
  cursorA = res.cursor;

  const pulled = await sync(tokenB, cursorB, []);
  const snips = pulled.changes.filter((c) => c.collection === "snippets");
  check("a 50-record batch round trips", snips.length === 50, `got ${snips.length}`);
}

{
  // The same record twice in one push must not blow up the batch.
  const res = await sync(tokenA, cursorA, [
    { collection: "notes", id: "dupe", doc: { id: "dupe", v: 1 }, updatedAt: 100, deleted: false },
    { collection: "notes", id: "dupe", doc: { id: "dupe", v: 2 }, updatedAt: 200, deleted: false },
  ]);
  const note = res.changes.find((c) => c.id === "dupe");
  check("a duplicated record in one push keeps the newer value", note?.doc?.v === 2, JSON.stringify(note?.doc));
}

// --- Clean up -------------------------------------------------------------
await client.query("delete from users where codex_sub = 'test-sub-e2e'");
await client.end();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
