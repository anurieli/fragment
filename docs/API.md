# HTTP API Reference

Every server route Fragment exposes, as implemented in `src/app/api/**/route.ts` and `src/app/r/**/route.ts`. 26 route files, 29 method/path pairs.

## Base URL

Routes are same-origin by default. The Tauri desktop build is a static export with no Next.js server of its own, so it points at a deployment through `NEXT_PUBLIC_FRAGMENT_API_BASE` (see `apiBase()` in `src/lib/sync/api.ts` and `src/lib/cloud-client.ts`). Web builds leave that unset and call relative paths.

## Two families

**Local / AI-proxy routes (no `/v1` prefix).** `/api/generate`, `/api/edit`, `/api/label`, `/api/analyze-voice`, `/api/models`, `/api/validate-key`, `/api/auth/codex/*`. These forward to an AI provider or to OpenAI's device-auth server. They hold no user state, require no session, and carry credentials supplied per request (a body field, or a header). They are protected by per-IP rate limits and body-size caps only.

**Hosted routes (`/api/v1/*`).** Sessions, sync, sharing, telemetry, feedback. These need a Postgres database (`DATABASE_URL`) and answer 503 when there is none. Two sub-groups sit inside this prefix and do not use sessions at all: the local-ingress routes (`/api/v1/agent-inbox`, `/api/v1/agent-inbox/ack`, `/api/v1/rss-proxy`, `/api/v1/publish/linkedin`), gated by `gateAgentInbox`, and the guest review routes (`/api/v1/review/[token]/*`), gated by the share token plus a guest cookie.

The reviewer-facing pages live outside `/api` entirely, at `/r/[token]` and `/r/[token]/enter`.

## Auth model

Five distinct mechanisms, and a given route uses exactly one:

- **None.** Anyone can call it. The AI proxy routes and the anonymous telemetry writers.
- **Session cookie.** `fragment_session` (`SESSION_COOKIE`, see `src/lib/session-cookie.ts`), httpOnly, SameSite=Lax, 60-day TTL. `getSessionUser()` in `src/lib/server/session.ts` resolves it. An `Authorization: Bearer <token>` header is accepted as an alternative, because the Tauri build runs on its own scheme and a SameSite=Lax cookie is never sent from there. The database stores only the SHA-256 of the token, so sessions stay revocable and the table leaks nothing presentable.
- **CSRF guard.** `guardJsonMutation()` in `src/lib/server/csrf.ts`. Not a token: an `Origin` check plus a `Content-Type: application/json` requirement. See Conventions.
- **Shared secret (local ingress).** `gateAgentInbox()` in `src/lib/agent-inbox/gate.ts`. Closed on the hosted build, closed unless `FRAGMENT_LOCAL_INGRESS=true`, open without a token for localhost or a host named in `FRAGMENT_INGRESS_ALLOWED_HOSTS`, otherwise requiring `Authorization: Bearer $FRAGMENT_INGRESS_TOKEN` exactly. A closed gate answers 404, never 401 or 403, so the route's existence is not disclosed.
- **Review token + guest cookie.** The unguessable share token in the path is the capability; a per-share httpOnly guest cookie (`guestCookieName(shareId)`) says which reviewer is speaking.

## Endpoint summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/generate` | none | Generate text, optionally streamed |
| POST | `/api/edit` | none | Rewrite a selection |
| POST | `/api/label` | none | Label a snippet |
| POST | `/api/analyze-voice` | none | Distill a brand voice from samples |
| GET | `/api/models` | none | List a provider's models |
| POST | `/api/validate-key` | none | Probe whether a provider key works |
| POST | `/api/auth/codex/start` | none | Start the Codex device-code flow |
| POST | `/api/auth/codex/token` | none | Poll or refresh Codex tokens |
| GET | `/api/v1/auth/session` | session cookie (optional) | Who am I |
| DELETE | `/api/v1/auth/session` | session cookie | Revoke this session |
| GET | `/api/v1/auth/google/start` | none | Begin Google sign-in |
| GET | `/api/v1/auth/google/callback` | none (OAuth state) | Finish sign-in, set cookie |
| POST | `/api/v1/sync` | session cookie + CSRF | Push and pull document deltas |
| POST | `/api/v1/shares` | session cookie + CSRF | Mint a share link |
| GET | `/api/v1/shares` | session cookie | List the owner's shares |
| PATCH | `/api/v1/shares/[id]` | session cookie + CSRF | Refresh the shared snapshot |
| DELETE | `/api/v1/shares/[id]` | session cookie | Revoke a share link |
| GET | `/api/v1/shares/[id]/reviews` | session cookie | Read all reviewer feedback |
| POST | `/api/v1/review/[token]/identify` | review token + CSRF | Guest gives an email, gets a cookie |
| POST | `/api/v1/review/[token]/submit` | review token + guest cookie + CSRF | Guest sends comments back |
| GET | `/r/[token]` | review token (+ guest cookie) | The reviewer's page |
| GET | `/r/[token]/enter` | review token + invite key | Set the guest cookie, redirect |
| GET | `/api/v1/agent-inbox` | shared secret | List pending agent files |
| POST | `/api/v1/agent-inbox/ack` | shared secret | Archive imported files, log status |
| GET | `/api/v1/rss-proxy` | shared secret | Fetch a Substack feed past CORS |
| POST | `/api/v1/publish/linkedin` | shared secret + Composio key | Proxy Composio LinkedIn calls |
| POST | `/api/v1/feedback` | none (session optional) | File in-app feedback to Linear |
| POST | `/api/v1/identify` | none (session optional) | Register a device |
| POST | `/api/v1/logs` | none (session optional) | Batch AI-call telemetry |

---

# Auth & session

### GET /api/v1/auth/session

Returns the current user, or null when signed out.

Auth: session cookie, optional. Runtime: `nodejs`.

```json
{ "user": { "id": "…", "email": "you@example.com", "name": "You" } }
```

Always 200. `user` is `null` when there is no valid session, and also when no database is configured, so a self-hosted build reads as signed out rather than broken.

There is deliberately no POST here. An earlier version accepted a Codex `id_token` and minted a Fragment session from it; that path was removed rather than left unused, because the Codex credential exists only to route AI calls.

Called by `fetchCurrentUser()` in `src/lib/sync/api.ts`.

### DELETE /api/v1/auth/session

Revokes the session this request presents and clears the cookie.

Auth: session cookie. Cross-site requests are refused via `isCrossSite()`. Runtime: `nodejs`.

- 200 `{ "ok": true }`
- 403 `{ "error": "Cross-site request refused" }`
- 503 when no database is configured

Called by `signOutOfCloud()` in `src/lib/sync/api.ts`.

### GET /api/v1/auth/google/start

Redirects the browser into Google's authorization endpoint, using the authorization-code flow with PKCE and a nonce.

Auth: none. Runtime: `nodejs`.

Query params:

| Name | Type | Notes |
|---|---|---|
| `returnTo` | string | Path to land on after sign-in. Passed through `safeReturnPath()`, which rejects anything not starting with a single `/`, defaulting to `/`. |

Sets four temporary httpOnly cookies scoped to `/api/v1/auth/google`, each with a 10 minute lifetime: `fragment_google_state`, `fragment_google_nonce`, `fragment_google_verifier`, `fragment_google_return`.

- 302 to `accounts.google.com`
- 503 when no database is configured, or when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `SESSION_COOKIE_SECURE`, `FRAGMENT_APP_URL` (via `googleRedirectUri`).

Called by `src/components/landing/landing-page.tsx` and `src/hooks/use-cloud-session.ts`.

### GET /api/v1/auth/google/callback

Exchanges the authorization code for tokens, verifies the OIDC `id_token` against Google's JWKS (audience, issuer, nonce), then calls `signIn({ provider: "google", … })`.

Auth: none in the header sense; the state cookie and PKCE verifier are what make the request trustworthy. Runtime: `nodejs`.

Query params: `code`, `state`, both supplied by Google.

Always answers with a redirect. On success it goes to the stored `returnTo` with `?signed_in=1`, sets the session cookie, and expires the four temporary cookies. On failure it redirects to `/?auth_error=<reason>`, where reason is `not_configured`, `invalid_state`, or `google_failed`. Failures never say more than that, so a broken exchange cannot be probed for detail.

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRAGMENT_APP_URL`.

### POST /api/auth/codex/start

Starts OpenAI's device-code flow for the Codex provider.

Auth: none. No body. No runtime declaration.

```json
{ "deviceAuthId": "…", "userCode": "ABCD-EFGH", "interval": 5 }
```

- 200 as above; `interval` falls back to 5 when the upstream value does not parse
- upstream's status with `{ "error": "Failed to start device auth: …" }`
- 503 `{ "error": "Could not reach OpenAI auth server" }`

Called by `src/lib/ai-client.ts`.

### POST /api/auth/codex/token

Two flows in one handler, chosen by which fields the body carries.

Auth: none. No runtime declaration.

Body, refresh flow:

```json
{ "refreshToken": "…" }
```

Body, device-poll flow:

```json
{ "deviceAuthId": "…", "userCode": "ABCD-EFGH" }
```

Responses:

- Refresh, 200: `{ "accessToken", "refreshToken", "identity" }`
- Poll pending, 200: `{ "status": "pending" }`. Upstream 403 and 404 both mean the user has not authorized yet, so they are translated rather than propagated.
- Poll success, 200: `{ "status": "success", "accessToken", "refreshToken", "identity" }`
- 400 `{ "error": "Missing deviceAuthId or userCode" }`
- 500 `{ "error": "Unexpected response from device auth", "status": "error" }`
- 503 `{ "error": "Could not reach auth server" }`
- Otherwise the upstream status, with `error` carrying `error_description` when the provider gave one

`identity` is decoded from the `id_token` (falling back to the access token) for display only. It is never verified and never treated as proof of who is calling.

Called by `src/lib/ai-client.ts`.

---

# Sync

### POST /api/v1/sync

Push local changes and pull everything this client has not seen, in one round trip.

Auth: session cookie, plus `guardJsonMutation`. Runtime: `nodejs`.

Body is a `SyncRequest` (`src/lib/sync/protocol.ts`):

```json
{
  "cursor": 0,
  "changes": [
    {
      "collection": "notes",
      "id": "note-1",
      "doc": { "title": "…" },
      "updatedAt": 1750000000000,
      "deleted": false
    }
  ]
}
```

`collection` must be one of `notes`, `snippets`, `noteVersions`, `ideas`, `contentPieces`, `resources`, `reviews`, `voices`, `voiceSamples`, `settings`. Unknown names are rejected outright, so a caller cannot grow the documents table under names no client will read back. `cursor` is the highest server-assigned `rev` this client has applied, 0 on a first sync. `doc` is null on a tombstone.

Response is a `SyncResponse`:

```json
{ "cursor": 1234, "changes": [], "hasMore": false }
```

Limits: 500 changes per push (`MAX_PUSH_CHANGES`), 500 per response (`MAX_PULL_CHANGES`), 8 MB body, 60 requests per minute. The rate limit is keyed on the user id rather than the IP, because what is worth bounding is how fast one account grows the shared table, and an address is the least stable part of an identity.

Statuses: 200, 400 (bad JSON or a protocol violation, with the specific reason in `error`), 401 `{ "error": "Not signed in" }`, 403 cross-site, 413, 415, 429 (with `Retry-After`), 500 `{ "error": "Sync failed" }`, 503.

Every row read or written is scoped to the session's user id. There is no parameter by which a caller names whose documents to touch.

Called by `postSync()` in `src/lib/sync/api.ts`.

---

# Sharing & reviews

### POST /api/v1/shares

Mints a share link for a note, freezing a copy of the markdown that reviewers will see, and optionally pre-inviting reviewers by email.

Auth: session cookie, plus `guardJsonMutation`. Runtime: `nodejs`.

```json
{
  "noteId": "note-1",
  "title": "Draft title",
  "markdown": "# …",
  "allowEdits": false,
  "invite": ["reader@example.com"]
}
```

`title` defaults to `"Untitled"`. `invite` is capped at 25 addresses per request, which keeps a bulk-mail vector closed.

```json
{
  "share": {
    "id": "…", "noteId": "…", "title": "…", "revision": 1,
    "allowEdits": false, "createdAt": "…", "expiresAt": "…"
  },
  "token": "…",
  "invited": [{ "email": "reader@example.com", "token": "…" }]
}
```

`token` appears exactly once. Only its hash is stored, so a lost link means minting a new one. Invitations return one token per address rather than sending mail: with no mail provider configured, handing back per-person links the owner can paste is the honest behavior.

Limits: 2 MB body, 30 requests per minute keyed on the user id.

Statuses: 200, 400 (`Expected a JSON body`, `Missing noteId`, `Nothing to share`), 401, 403, 413 `{ "error": "Draft too large to share." }`, 415, 429, 503.

### GET /api/v1/shares

Lists this user's shares, with a comment count per share.

Auth: session cookie. Runtime: `nodejs`.

Query params:

| Name | Type | Notes |
|---|---|---|
| `noteId` | string | Optional. Restricts the list to one note. |

```json
{
  "shares": [
    {
      "id": "…", "noteId": "…", "title": "…", "revision": 1,
      "allowEdits": false, "createdAt": "…", "revokedAt": null,
      "expiresAt": "…", "commentCount": 3, "lastCommentAt": "…"
    }
  ]
}
```

Statuses: 200, 401, 503.

### PATCH /api/v1/shares/[id]

Refreshes the frozen copy reviewers see and bumps the revision.

Auth: session cookie, plus `guardJsonMutation`. Runtime: `nodejs`.

```json
{ "markdown": "# …", "title": "Draft title" }
```

```json
{ "share": { "id": "…", "title": "…", "revision": 2 } }
```

Statuses: 200, 400, 401, 403, 404 `{ "error": "Not found" }`, 415, 503.

The underlying query is keyed on `(id, user_id)`, so a share belonging to someone else is indistinguishable from one that does not exist.

### DELETE /api/v1/shares/[id]

Revokes the link. Feedback already collected stays.

Auth: session cookie; cross-site requests are refused. Runtime: `nodejs`.

Statuses: 200 `{ "ok": true }`, 401, 403, 404, 503. Already-revoked and never-existed both answer 404, so the caller learns nothing either way.

### GET /api/v1/shares/[id]/reviews

Everything every reviewer said about one share.

Auth: session cookie, owner only. Runtime: `nodejs`.

```json
{
  "reviews": [
    {
      "guestId": "…", "email": "reader@example.com", "name": "Reader",
      "invited": true, "lastSeenAt": "…",
      "comments": [
        { "id": "…", "anchorText": "…", "prefix": "…", "suffix": "…",
          "body": "…", "createdAt": "…", "revision": 1 }
      ],
      "editedFullText": null, "editedAt": null
    }
  ]
}
```

Statuses: 200, 401, 404, 503.

This is the only sharing route that returns more than one person's comments, and it resolves the share by `(id, user_id)`. Guests read their own comments from the review page instead, which is served with only their rows.

### POST /api/v1/review/[token]/identify

The entire signup flow for a guest: an email address and nothing else.

Auth: the share token in the path, plus `guardJsonMutation`. Runtime: `nodejs`.

```json
{ "email": "reader@example.com", "name": "Reader" }
```

`name` is optional. `email` is validated by shape only.

```json
{ "ok": true, "name": "Reader", "email": "reader@example.com" }
```

Sets an httpOnly guest cookie scoped to this share, 90 days, so a review cycle outlives a browser restart without being permanent.

Limits: 20 requests per minute per IP, the only backstop on a public unauthenticated route.

Statuses: 200, 400 (`Expected a JSON body`, `Enter a valid email address.`), 403, 404 `{ "error": "This link is no longer active." }`, 415, 429, 503.

The address is never treated as proof of anything. The capability is the link, which the caller already holds; the address only labels whose comments are whose, and the reviewer's own token still partitions what they can read.

### POST /api/v1/review/[token]/submit

A reviewer sending their pass back to the author.

Auth: the share token in the path, the guest cookie for that share, plus `guardJsonMutation`. Runtime: `nodejs`.

```json
{
  "comments": [
    { "id": "…", "anchorText": "…", "prefix": "…", "suffix": "…", "body": "…" }
  ],
  "editedFullText": "…",
  "reviewerName": "Reader",
  "revision": 1
}
```

`comments` runs through `sanitizeComments()`. `editedFullText` is accepted only when the owner left `allowEdits` on; a reviewer whose permission was revoked mid-review keeps their comments and loses only the rewrite. `revision` falls back to the share's current revision when absent or not a finite number.

```json
{ "ok": true, "saved": 3 }
```

Limits: 2 MB body, 20 requests per minute per IP.

Statuses: 200, 400, 401 `{ "error": "Tell us who you are first.", "needsIdentity": true }` (the page re-asks for an address rather than failing opaquely), 403, 404, 413 `{ "error": "That review is too large to send." }`, 415, 429, 503.

A guest cookie minted for a different share does not authenticate here, which is what stops a stale cookie from filing one person's comments under someone else's review.

### GET /r/[token]

The page a reviewer lands on. Serves HTML, not JSON.

Auth: the share token in the path; the guest cookie decides which of two states is rendered. Runtime: `nodejs`, `dynamic = "force-dynamic"`.

- No guest cookie: the email gate, a self-contained page that posts to `/api/v1/review/[token]/identify`.
- Valid guest cookie: the standalone review document, seeded with this reviewer's comments and nobody else's.

Statuses: 200 with `text/html`, or 404 with the "link isn't active" shell when the token is unknown, revoked, expired, or when no database is configured. The shell deliberately does not say which.

Response headers: `cache-control: private, no-store`, `referrer-policy: no-referrer`, `x-robots-tag: noindex, nofollow`. Every response depends on a cookie and a database row, so caching one reviewer's page and serving it to the next would be the exact failure the feature exists to prevent.

This is a route handler rather than a React page because what is served is a standalone document with its own styles and its own vanilla-JS comment engine. The author's email address is not included; comments travel over HTTP here, so there is no reason to disclose it to everyone holding the link.

Link built by `src/lib/sharing/client.ts`.

### GET /r/[token]/enter

The link an invited reviewer clicks in their email. Sets the guest cookie and redirects to the document, so an invitee never sees the gate.

Auth: the share token in the path plus the invite key. Runtime: `nodejs`, `dynamic = "force-dynamic"`.

Query params:

| Name | Type | Notes |
|---|---|---|
| `k` | string | The guest token from the invitation. Checked against this share only. |

Always 302 to `/r/<token>` with `cache-control: private, no-store`. An unrecognized or missing key still redirects, falling through to the gate, so an expired invitation can still read and comment. The `Location` is relative on purpose: `req.nextUrl.origin` does not reliably reproduce the host behind a proxy, and a relative target is structurally incapable of pointing off-site.

Redirecting immediately strips the key from the address bar after one use, keeping it out of history, screenshots, and any URL the reviewer pastes onward.

---

# Agent ingress

All four routes in this section share `gateAgentInbox` and answer 404 when the gate is closed.

Env for all four: `NEXT_PUBLIC_FRAGMENT_HOSTED`, `FRAGMENT_LOCAL_INGRESS`, `FRAGMENT_INGRESS_TOKEN`, `FRAGMENT_INGRESS_ALLOWED_HOSTS`.

### GET /api/v1/agent-inbox

Lists pending agent handoff files from the local inbox directory.

Auth: shared secret via the gate. Runtime: `nodejs`.

Query params:

| Name | Type | Notes |
|---|---|---|
| `since` | number | Epoch ms. Filters handoff files by mtime. Ignored when not a finite number. Does not apply to `resourceFiles` or `ideaFiles`. |

```json
{
  "files": [{ "fileName": "piece.md", "relPath": "idea-1/piece.md", "content": "…", "mtime": 1750000000000 }],
  "resourceFiles": [{ "ideaId": "idea-1", "relPath": "idea-1/resources.jsonl", "content": "…", "mtime": 1750000000000 }],
  "ideaFiles": [{ "ideaId": "idea-1", "relPath": "idea-1/idea.md", "content": "…" }]
}
```

Reads `~/.fragment/inbox` recursively, or `FRAGMENT_INBOX_DIR` when set, skipping `.imported/` and `.status.jsonl`. Resource files are always returned in full rather than filtered by `since`, because the importer's upsert is idempotent by id, which makes re-reading the whole file on every poll cheap and safe. The route never follows a caller-supplied path; it accepts none.

Env, additionally: `FRAGMENT_INBOX_DIR`.

Called by `src/hooks/use-agent-inbox.ts`.

### POST /api/v1/agent-inbox/ack

Archives files the client has finished importing, and appends status events.

Auth: shared secret via the gate. Runtime: `nodejs`.

```json
{
  "imported": ["idea-1/piece.md"],
  "statusEvents": [{ "pieceId": "piece-1", "status": "published", "at": 1750000000000 }]
}
```

Each `imported` entry is a relPath as returned by GET, validated with `resolveInboxRelPath` before any filesystem write; anything absolute or normalizing outside the inbox is rejected rather than followed. Valid entries move into `.imported/`, mirroring their subdirectory and uniquifying on filename collision. Status events are appended to `.status.jsonl` as JSON lines tagged `by: "user"`; entries that do not match `{ pieceId: string, status: string, at: number }` are dropped silently.

```json
{ "results": [{ "relPath": "idea-1/piece.md", "ok": true, "movedTo": ".imported/idea-1/piece.md" }] }
```

Failures are reported per path, for example `{ "relPath": "…", "ok": false, "error": "invalid path" }`.

Statuses: 200, 400 `{ "error": "invalid JSON body" }`, 404 when the gate is closed.

Env, additionally: `FRAGMENT_INBOX_DIR`.

Called by `src/lib/agent-inbox/client.ts` and `src/hooks/use-agent-inbox.ts`.

### GET /api/v1/rss-proxy

Fetches a Substack RSS feed server-side, to route around browser CORS while the publish flow polls for a title match.

Auth: shared secret via the gate. Runtime: `nodejs`.

Query params:

| Name | Type | Notes |
|---|---|---|
| `pub` | string | A bare publication host. Validated by shape with `isValidFeedHost`; never a full URL. Self-hosted Substacks run on arbitrary custom domains, so there is no fixed allowlist to check against. |

- 200 with the raw feed as `application/xml; charset=utf-8`
- 404 when the gate is closed, or when `pub` is missing or fails validation
- 502 `{ "error": "feed fetch failed" }` when the upstream errors or is unreachable

Tauri builds skip this route and fetch the feed directly, since a static export has no Next.js server to run it.

Called by `src/hooks/use-publish-verification.ts`.

### POST /api/v1/publish/linkedin

Proxies the three Composio calls that "Publish to LinkedIn" needs: starting a Connect Link session, polling connection status, and executing a LinkedIn tool.

Auth: shared secret via the gate, plus the caller's Composio API key in `Authorization: Bearer <key>`. Runtime: `nodejs`.

Body is a `ComposioAction` discriminated union (`src/lib/composio/linkedin.ts`):

```json
{ "kind": "link", "userId": "fragment-local-user" }
```

```json
{ "kind": "status", "connectedAccountId": "…" }
```

```json
{
  "kind": "execute",
  "toolSlug": "LINKEDIN_CREATE_LINKED_IN_POST",
  "connectedAccountId": "…",
  "userId": "fragment-local-user",
  "arguments": {}
}
```

The response is Composio's own body, passed through with Composio's status code. The key travels only in the header, is never read from the body, and is never logged or included in a thrown error.

Statuses: Composio's status on a completed call, 400 (`Invalid request body.` or `Invalid action.`), 401 `{ "error": "Missing Composio API key." }`, 404 when the gate is closed, 502 `{ "error": "Couldn't reach Composio." }`.

Known limitation, documented in the handler: the gate and this route both want the `Authorization` header, for `FRAGMENT_INGRESS_TOKEN` and the Composio key respectively. From a non-localhost Host the header can only satisfy one, so in practice the route works out of the box only when the request's Host is localhost. The hosted build cannot publish through this route at all, since it has no local-ingress story to gate on.

The Tauri build never calls this route; it reaches Composio directly, because its native HTTP plugin is not subject to the WebView's CORS policy.

Called by `src/lib/composio/linkedin.ts`.

---

# AI proxy

The four generation routes share a structure: validate the provider, substitute a client-supplied prompt template, forward to the provider, and return the completion alongside a `_meta` block. The prompt template comes from the client, so the server does not own the wording. Credentials come from the body (`apiKey`, or `codexToken` for Codex); the server env key is used only as a fallback, and only when the build is hosted and `FRAGMENT_ENABLE_MANAGED_AI=true`.

Valid `provider` values: `openrouter`, `openai`, `perplexity`, `anthropic`, `codex`, `ollama`.

Shared limits: 20 requests per minute per IP, 1 MB request body (`Content-Length`, checked before parsing), 500,000 characters in the composed prompt. None of these routes declares a runtime.

Env, when the managed-AI fallback is enabled: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`, plus `NEXT_PUBLIC_FRAGMENT_HOSTED` and `FRAGMENT_ENABLE_MANAGED_AI`.

The `_meta` block on a successful non-streaming call:

```json
{
  "durationMs": 812,
  "statusCode": 200,
  "promptLength": 1204,
  "responseLength": 640,
  "promptTokens": 300,
  "completionTokens": 160,
  "totalTokens": 460,
  "cost": 0.0004,
  "modelRequested": "gpt-4o-mini",
  "modelUsed": "gpt-4o-mini",
  "request": { }
}
```

`request` is a redacted snapshot of the input fields (see `src/lib/api-log-details.ts`), sampled head, tail, or whole depending on the field.

### POST /api/generate

Generates text at a cursor, either as one response or as a stream.

Auth: none.

Body fields, all optional except `provider`: `contextAbove`, `contextBelow`, `goal`, `audience`, `tone`, `remember`, `userInstruction`, `promptTemplate`, `voiceContext` (strings); `model` (string); `provider` (one of the six); `apiKey`, `codexToken` (strings); `stream` (boolean).

`promptTemplate` placeholders substituted server-side: `{goal}`, `{audience}`, `{tone}`, `{remember}`, `{contextAbove}`, `{contextBelow}`, `{userInstruction}`. `voiceContext` is passed as the system message rather than substituted.

Non-streaming response:

```json
{ "content": "…", "_meta": { } }
```

Streaming response, when `stream` is true: `text/event-stream` with `Cache-Control: no-cache`. Events are one JSON object per `data:` line:

```
data: {"content":"partial text"}

data: {"done":true,"usage":{"promptTokens":300,"completionTokens":160,"totalTokens":460}}
```

A streaming error is delivered in the same shape, `data: {"error":"…","done":true}`, with the HTTP status set accordingly.

Statuses: 200; 400 `{ "error": "Invalid provider" }`; 401 `{ "error": "Provider not authenticated" }`; 400 `{ "error": "No API key configured" }`; the upstream status with `{ "error": "Generation failed" }`; 413; 429 with `Retry-After`; 503 `{ "error": "Provider not reachable" }`.

Called by `src/lib/ai-client.ts`.

### POST /api/edit

Rewrites a selection in place.

Auth: none.

Body: `selectedText`, `contextBefore`, `contextAfter`, `goal`, `audience`, `tone`, `remember`, `instruction`, `promptTemplate`, `voiceContext`, `model`, `provider`, `apiKey`, `codexToken`. No streaming.

Placeholders: `{goal}`, `{audience}`, `{tone}`, `{remember}`, `{contextBefore}`, `{contextAfter}`, `{selectedText}`, `{instruction}`.

```json
{ "content": "…", "_meta": { } }
```

Statuses: 200; 400 `Invalid provider` or `No API key configured`; 401 `Provider not authenticated`; the upstream status with `{ "error": "Edit failed" }`; 413; 429; 503 `{ "error": "Provider not reachable" }`.

Called by `src/lib/ai-client.ts`.

### POST /api/label

Produces a short label for a snippet.

Auth: none.

Body: `snippetContent`, `essayContent`, `goal`, `promptTemplate`, `model`, `provider`, `apiKey`, `codexToken`.

Placeholders: `{goal}`, `{essayContent}`, `{snippetContent}`. The route wraps `goal` and `essayContent` in framing text before substituting.

```json
{ "label": "Opening hook", "_meta": { } }
```

Statuses: 200; 400 `{ "label": "Invalid provider" }`; 401 when Codex is unauthenticated; the upstream status with `{ "label": "AI labeling failed" }`; 413; 429; 503 with the same label.

A missing API key answers 200 with `{ "label": "AI labeling unavailable" }` rather than an error status. Labeling is a non-blocking convenience, so the snippet stays unlabeled instead of raising a toast.

Called by `src/lib/ai-client.ts`.

### POST /api/analyze-voice

Distills a brand voice from writing samples. Returns the raw model completion; parsing into a voice profile happens client-side, so web and Tauri behave identically.

Auth: none.

Body: `voiceName`, `description`, `samplesText`, `promptTemplate`, `model`, `provider`, `apiKey`, `codexToken`.

Placeholders: `{voiceName}`, `{description}`, `{samples}`. Substitution is a single pass with a function replacer, not chained `String.replace` calls, for two reasons: a string replacement special-cases `$$`, `$&`, `` $` `` and `$'`, which raw document content can contain and would silently mangle; and one pass means a `{samples}` appearing inside `description` cannot hijack the real placeholder.

```json
{ "content": "…", "_meta": { } }
```

Statuses: 200; 400 `Invalid provider` or `No API key configured`; 401 `Provider not authenticated`; the upstream status with `{ "error": "Voice analysis failed" }`; 413; 429; 503 `{ "error": "Provider not reachable" }`.

Called by `src/lib/ai-client.ts`.

### GET /api/models

Lists the models available from a provider.

Auth: none. Rate limit: 40 requests per minute per IP, looser than the generation routes because it is read-only.

Query params:

| Name | Type | Notes |
|---|---|---|
| `provider` | string | Defaults to `openrouter`. |

Headers:

| Name | Notes |
|---|---|
| `x-api-key` | The provider key. Falls back to the server env key under managed AI. |
| `x-auth-token` | The Codex access token, for `provider=codex`. |

```json
{ "models": [], "_meta": { "durationMs": 42, "statusCode": 200 } }
```

Providers with no list endpoint (Perplexity today) serve a curated static list and never hit the network.

Statuses: 200; 400 `{ "models": [], "_meta": { "error": "Invalid provider" } }`; 401 with `{ "code": "AI_AUTH_REQUIRED" }` when no credential resolves; the upstream status on a failed fetch. An unreachable provider answers **200** with `error` and `_meta.statusCode: 503` in the body rather than a 503 status; the body is the source of truth here.

Only OpenRouter's public list is cached (one hour, via `next.revalidate`). Keyed or authenticated lists are not.

Called by `src/lib/ai-client.ts`.

### POST /api/validate-key

Probes whether a provider credential actually works, by sending a one-word prompt capped at one output token.

Auth: none. Rate limit: 20 per minute per IP. Body cap: 1 MB.

```json
{ "provider": "perplexity", "apiKey": "…" }
```

```json
{ "ok": true }
```

```json
{ "ok": false, "error": "That key was rejected." }
```

Always answers HTTP 200 except for 413 and 429; correctness lives in the `ok` field, matching `/api/models`' error-envelope style. It never falls back to the server env key, because the point is to check the user's own credential.

This exists for providers with no live models endpoint to prove a key works. Everything else validates through `getModels()` instead.

Called by `src/lib/ai-client.ts`.

---

# Publishing

Publishing is covered by two routes documented above, both under the local-ingress gate: `POST /api/v1/publish/linkedin` for the Composio LinkedIn flow, and `GET /api/v1/rss-proxy` for Substack publish verification. There is no hosted-build publishing route today.

---

# Feedback & telemetry

These three accept anonymous callers, attach the user id when a session happens to be present, and are capped per IP for that reason. None of them uses the CSRF guard.

### POST /api/v1/feedback

Files in-app feedback directly as a Linear issue, with media uploaded into Linear's own storage. There is no server-side queue: the table this replaced was write-only and its media keys pointed at local disk that a serverless platform discards between invocations.

Auth: none; the session is read only to label the submitter. Content type: `multipart/form-data`. Runtime: `nodejs`.

Form fields:

| Field | Type | Notes |
|---|---|---|
| `payload` | JSON string | Metadata. `type` must be `bug`, `feature` or `feedback`; `message` is required. Optional: `deviceId`, `platform`, `appVersion`, `screenResolution`, `activeNoteId`, `userAgent`. |
| `screenshot` | file | Optional. |
| `screenRecording` | file | Optional. |
| `voiceNote` | file | Optional. |

Each file is capped at 25 MB. Bugs are filed at Linear priority 2, everything else at 3. The title is `[type]` plus the first line of the message, truncated at 72 characters.

Limits: 10 requests per minute per IP.

Statuses: 200 `{ "ok": true }`; 400 (`Expected multipart form data`, `payload is not valid JSON`, `type must be bug, feature or feedback`, `message is required`); 413 `{ "error": "<field> exceeds 26214400 bytes" }`; 429; 500 `{ "error": "Failed to record feedback" }`.

When `LINEAR_API_KEY` is unset the behavior splits: a database-backed deployment answers 500 `{ "error": "Feedback is not configured" }`, since pretending the report was filed would silently eat it, while a bare local checkout with neither answers 200 and drops it, which is fine in dev.

Attachment uploads are best-effort. A report whose screenshot failed to upload is still filed, and the issue body records which attachments went missing.

Env: `LINEAR_API_KEY`, `DATABASE_URL`. The Linear team and project ids are constants in `src/lib/server/linear.ts`.

Called by `submitFeedback()` in `src/lib/cloud-client.ts`.

### POST /api/v1/identify

Records that an install exists and what it is. A device is not an account: this fires before anyone signs in, which is why it is keyed on a client-generated device id. When a session is present the user id is attached too, so a device can later be traced to the person using it.

Auth: none; the session is optional. Runtime: `nodejs`.

```json
{
  "deviceId": "…",
  "name": "…",
  "email": "…",
  "platform": "web",
  "appVersion": "1.2.3",
  "writingTypes": ["essay"],
  "role": "…",
  "profileSource": "…"
}
```

Only `deviceId` is required. The insert is an upsert on the device id, and each column is `coalesce`d, so a later call that omits a field does not blank what an earlier one recorded.

Limits: 30 requests per minute per IP.

Statuses: 200 `{ "ok": true }`; 400 (`Expected a JSON body`, `Missing deviceId`); 429; 500 `{ "error": "Failed to record device" }`.

With no database configured it answers 200 and does nothing. Telemetry must never be the reason a self-hosted app shows an error.

Env: `DATABASE_URL`.

Called by `identify()` in `src/lib/cloud-client.ts`.

### POST /api/v1/logs

Batched AI-call telemetry: which provider, which model, how long, how many tokens.

Auth: none; the session is optional. Runtime: `nodejs`.

```json
{
  "deviceId": "…",
  "logs": [
    {
      "route": "/api/generate", "caller": "flow", "provider": "openai",
      "model": "gpt-4o-mini", "status": "success", "statusCode": 200,
      "error": null, "durationMs": 812, "promptTokens": 300,
      "completionTokens": 160, "totalTokens": 460, "cost": 0.0004,
      "promptLength": 1204, "responseLength": 640,
      "clientTimestamp": 1750000000000
    }
  ]
}
```

At most 200 entries are taken per request; the rest are dropped without error. `error` strings are truncated at 2000 characters. Non-finite numerics become null. The whole batch is written in one statement via `unnest`, so a client that queued calls while offline still costs one round trip.

Limits: 30 requests per minute per IP.

Statuses: 200 `{ "ok": true }`; 400 (`Expected a JSON body`, `logs must be an array`); 429; 500 `{ "error": "Failed to record logs" }`.

With no database configured it answers 200 and does nothing. These rows never sync back down to a client, which is why they are not part of the documents table.

Env: `DATABASE_URL`.

Called by `src/lib/cloud-client.ts`.

---

# Conventions

## Error response shape

Cloud routes return a single string field:

```json
{ "error": "Not signed in" }
```

The AI proxy routes wrap it in the same envelope they use on success, so a client reads one shape either way:

```json
{ "error": "Generation failed", "_meta": { "durationMs": 120, "statusCode": 502, "error": "openai generation failed: …" } }
```

`error` at the top level is what a user may see. `_meta.error` is the diagnostic detail, and the two are not the same string. `/api/label` uses `label` in place of `content`, including on failure, so an error never breaks the field the caller reads.

`/api/models` and `/api/validate-key` are the exceptions to status-code signalling: both can report failure inside a 200 body. Read `ok`, or `_meta.statusCode`, rather than the HTTP status on those two.

## CSRF requirement rules

`guardJsonMutation()` applies to state-changing JSON routes: `POST /api/v1/sync`, `POST /api/v1/shares`, `PATCH /api/v1/shares/[id]`, `POST /api/v1/review/[token]/identify`, `POST /api/v1/review/[token]/submit`. `DELETE /api/v1/auth/session` and `DELETE /api/v1/shares/[id]` run the origin half only, since a DELETE has no body to type-check and is not reachable from a plain HTML form anyway.

Two independent barriers, either sufficient alone:

1. `Origin`, when present, must match the request's `Host`. Browsers always send `Origin` on a cross-origin POST, form submissions included, so a mismatch is decisive. An absent `Origin` means a non-browser caller (the Tauri build, curl), which no attacker page can drive, so it passes. An unparseable `Origin` is treated as cross-site. Violation: **403** `{ "error": "Cross-site request refused" }`.
2. `Content-Type` must start with `application/json`. A plain HTML form can only send `text/plain`, `multipart/form-data` or `urlencoded`, so requiring JSON blocks the text/plain body-smuggling trick that slips past a `req.json()` which never inspects the header. Violation: **415** `{ "error": "Expected a JSON body" }`.

The routes that skip the guard do so for a reason: the AI proxy routes hold no user state, the telemetry routes hold nothing worth forging, and `/api/v1/feedback` is multipart by design.

## What a 503 means

A 503 from any `/api/v1/*` route almost always means `DATABASE_URL` is unset, not that the server is overloaded.

Fragment ships in three shapes and only one has a database. The open-source and desktop builds are local-first with no server; the hosted build is the same client with a backend behind it. So every cloud route asks `isDatabaseConfigured()` first and answers without throwing. `DATABASE_URL` unset is a supported configuration, not a misconfiguration.

The standard body is `{ "error": "This Fragment build has no cloud configured." }`. The review routes say `{ "error": "Sharing is not available on this build." }` instead. `/api/v1/auth/google/start` also returns 503 when the Google client id or secret is missing.

Three routes deliberately do not follow this: `GET /api/v1/auth/session` reports a null user, and `/api/v1/identify` and `/api/v1/logs` report success and drop the write, because none of those should make a self-hosted install look broken.

The AI proxy routes use 503 in its ordinary sense: the upstream provider was unreachable.
