import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { findShareByToken, findGuestByToken, guestCookieName } from "@/lib/server/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The link an invited reviewer clicks in their email.
 *
 * `/r/<share>/enter?k=<guest>` sets the guest cookie and redirects to the
 * document, so an invitee never sees the "who's reading?" gate. That is the
 * point of inviting someone by name: we already know.
 *
 * This exists as a separate route because a React Server Component cannot set
 * a cookie, and the alternative (reading `?k=` on every page load) would keep
 * the secret in the address bar for the whole session, where it lands in
 * browser history, screenshots and any URL the reviewer pastes to a friend.
 * Redirecting immediately strips it after one use.
 *
 * The token in the URL is a capability, exactly like any magic link: whoever
 * holds it acts as that invitee. Forwarding the email forwards the identity.
 * That is understood and accepted for invitations, where the owner chose the
 * recipient. It is precisely what is NOT accepted for self-identified guests,
 * who get an unguessable token instead of a claimable email address.
 */
/**
 * A relative Location, rather than NextResponse.redirect's absolute URL.
 *
 * `req.nextUrl.origin` does not reliably reproduce the host the caller
 * actually asked for (behind a proxy it resolved to localhost in testing),
 * and guessing it from headers means trusting a header to decide where to
 * send someone. RFC 7231 permits a relative Location and every browser
 * resolves it against the current URL, which is exactly the host we want and
 * is structurally incapable of pointing off-site.
 */
function backToDocument(token: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: {
      location: `/r/${encodeURIComponent(token)}`,
      "cache-control": "private, no-store",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  if (!isDatabaseConfigured()) return backToDocument(token);

  const share = await findShareByToken(token);
  if (!share) return backToDocument(token);

  const key = req.nextUrl.searchParams.get("k");
  if (!key) return backToDocument(token);

  // Scoped to this share, so a token from another draft cannot bind here.
  const guest = await findGuestByToken(key, share.id);

  const res = backToDocument(token);
  if (guest) {
    res.cookies.set(guestCookieName(share.id), key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE !== "false",
      path: "/",
      maxAge: 90 * 24 * 60 * 60,
    });
  }
  // An unrecognised key falls through to the gate rather than erroring: an
  // expired invitation should still let someone read and comment.
  return res;
}
