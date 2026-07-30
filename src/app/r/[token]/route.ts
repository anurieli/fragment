import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { buildHostedReviewPage } from "@/lib/review";
import { escapeHtml } from "@/lib/review/template";
import {
  findShareByToken,
  findGuestByToken,
  listCommentsForGuest,
  guestCookieName,
} from "@/lib/server/shares";
import { queryOne } from "@/lib/server/db";

export const runtime = "nodejs";
// Every response here depends on a cookie and a database row. Caching one
// reviewer's page and serving it to the next would be the exact failure the
// whole feature is designed to prevent.
export const dynamic = "force-dynamic";

/**
 * The page a reviewer lands on.
 *
 * A route handler rather than a React page, because what is served is the
 * standalone review document (src/lib/review/template.ts) — a self-contained
 * page with its own styles and its own vanilla-JS comment engine. Wrapping it
 * in the app's root layout would give it a nav bar it has no use for and a
 * bundle it does not need. A reviewer is not a user of the app; they are a
 * guest looking at one document.
 *
 * Two states:
 *   - no guest cookie: the email gate, which is the entire signup flow
 *   - a valid guest cookie: the document, seeded with THIS reviewer's
 *     comments and nobody else's
 */

function page(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Belt and braces alongside force-dynamic: no shared cache should ever
      // hold a page that was personalised by cookie.
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** A dead, revoked or expired link. Deliberately says nothing about which. */
function goneShell(): string {
  return shell(
    "Link not active",
    `<h1 class="gate-title">This link isn't active</h1>
     <p class="gate-sub">It may have been turned off by the author, or it may have expired. Ask them for a fresh one.</p>`,
  );
}

/**
 * Minimal chrome for the pre-document states. Deliberately not the app's
 * global CSS: this page is served to strangers and should load as one file
 * with no dependencies, exactly like the emailed version.
 */
function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0c0c0b; color: #e8e4dc; padding: 24px;
    font-family: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .gate { width: 100%; max-width: 420px; }
  .gate-eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #8a8578; margin: 0 0 20px; }
  .gate-title { font-family: Georgia, "Times New Roman", serif; font-size: 30px; line-height: 1.2; margin: 0 0 10px; font-weight: 400; }
  .gate-sub { color: #a5a093; font-size: 15px; line-height: 1.6; margin: 0 0 26px; }
  .gate-label { display: block; font-size: 13px; color: #a5a093; margin: 0 0 7px; }
  .gate-input {
    width: 100%; padding: 11px 13px; margin-bottom: 14px; border-radius: 8px;
    border: 1px solid #2e2c28; background: #151412; color: #e8e4dc; font-size: 15px; font-family: inherit;
  }
  .gate-input:focus { outline: none; border-color: #c9a961; }
  .gate-btn {
    width: 100%; padding: 12px; border-radius: 8px; border: none; cursor: pointer;
    background: #c9a961; color: #17150f; font-size: 15px; font-weight: 600; font-family: inherit;
  }
  .gate-btn:disabled { opacity: .6; cursor: default; }
  .gate-note { color: #6f6b60; font-size: 12.5px; line-height: 1.6; margin: 18px 0 0; }
  .gate-error { color: #e0755f; font-size: 13.5px; margin: 0 0 12px; min-height: 18px; }
</style>
</head>
<body><div class="gate">
  <p class="gate-eyebrow">Fragment · Review</p>
  ${inner}
</div></body>
</html>`;
}

/** The whole guest signup: one address, no account. */
function gate(token: string, title: string, authorName: string): string {
  const who = authorName ? `${escapeHtml(authorName)} asked you` : "You've been asked";
  return shell(
    `Review: ${title}`,
    `<h1 class="gate-title">${escapeHtml(title)}</h1>
     <p class="gate-sub">${who} to read this draft and leave comments. No account needed, just tell them who's reading.</p>
     <form id="gate-form" autocomplete="on">
       <p class="gate-error" id="gate-error" role="alert"></p>
       <label class="gate-label" for="gate-email">Your email</label>
       <input class="gate-input" id="gate-email" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
       <label class="gate-label" for="gate-name">Your name <span style="opacity:.6">(optional)</span></label>
       <input class="gate-input" id="gate-name" type="text" name="name" placeholder="How you'd like to be credited" autocomplete="name">
       <button class="gate-btn" id="gate-submit" type="submit">Start reading</button>
     </form>
     <p class="gate-note">Your address is only shown to the author, so they know whose notes are whose. It isn't used to create an account and you won't be emailed by Fragment.</p>
     <script>
     (function () {
       var form = document.getElementById("gate-form");
       var btn = document.getElementById("gate-submit");
       var err = document.getElementById("gate-error");
       form.addEventListener("submit", function (e) {
         e.preventDefault();
         var email = document.getElementById("gate-email").value.trim();
         var name = document.getElementById("gate-name").value.trim();
         if (!email) return;
         btn.disabled = true; err.textContent = "";
         fetch(${JSON.stringify(`/api/v1/review/${token}/identify`)}, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           credentials: "same-origin",
           body: JSON.stringify({ email: email, name: name || undefined })
         }).then(function (res) {
           if (!res.ok) return res.json().catch(function(){return {};}).then(function (d) {
             throw new Error(d.error || "Something went wrong.");
           });
           window.location.reload();
         }).catch(function (e2) {
           btn.disabled = false;
           err.textContent = e2.message || "Something went wrong.";
         });
       });
     })();
     </script>`,
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!isDatabaseConfigured()) return page(goneShell(), 404);

  const { token } = await ctx.params;
  const share = await findShareByToken(token);
  if (!share) return page(goneShell(), 404);

  const owner = await queryOne<{ name: string | null; email: string | null }>(
    "select name, email from users where id = $1",
    [share.userId],
  );

  const guestToken = req.cookies.get(guestCookieName(share.id))?.value;
  const guest = guestToken ? await findGuestByToken(guestToken, share.id) : null;

  if (!guest) {
    return page(gate(token, share.title, owner?.name ?? ""));
  }

  // The reviewer's own comments, and structurally only those: this function
  // takes a guest id and has no parameter that could widen it to the share.
  const mine = await listCommentsForGuest(guest.id);

  return page(
    buildHostedReviewPage(
      { title: share.title, markdown: share.snapshotMarkdown },
      {
        docId: share.id,
        submitUrl: `/api/v1/review/${token}/submit`,
        revision: share.revision,
        allowEdits: share.allowEdits,
        authorName: owner?.name ?? "",
        // The author's address is not handed to guests. In the emailed
        // version it fills a mailto; here the comments travel over HTTP, so
        // there is no reason to disclose it to everyone holding the link.
        authorEmail: "",
        reviewerName: guest.name ?? "",
        initialComments: mine.map((c) => ({
          id: c.id,
          anchorText: c.anchorText,
          prefix: c.prefix,
          suffix: c.suffix,
          body: c.body,
        })),
      },
    ),
  );
}
