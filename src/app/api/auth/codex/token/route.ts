import { NextRequest, NextResponse } from "next/server";
import {
  CODEX_CLIENT_ID,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_TOKEN_URL,
  CODEX_DEVICE_AUTH_REDIRECT,
} from "@/lib/codex-auth";
import { extractCodexIdentity, type CodexIdentity } from "@/lib/codex-api";

/**
 * Pull the user's identity out of the token response for display only (e.g.
 * "connected as name@email" in Settings). Prefers the OIDC `id_token`
 * (stable per-user `sub`); falls back to the access token, which carries the
 * same claims. Never verified and never used for anything beyond a label —
 * this credential's only real job is routing AI calls through Codex, and it
 * must never be trusted as proof of who is asking.
 */
function identityFromTokenData(data: {
  id_token?: string;
  access_token?: string;
}): CodexIdentity | null {
  if (data.id_token) {
    const fromId = extractCodexIdentity(data.id_token);
    if (fromId) return fromId;
  }
  return data.access_token ? extractCodexIdentity(data.access_token) : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    deviceAuthId?: string;
    userCode?: string;
    refreshToken?: string;
  };

  // Token refresh flow
  if (body.refreshToken) {
    try {
      const res = await fetch(CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CODEX_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: body.refreshToken,
          scope: "openid profile email",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: data.error_description || data.error || "Refresh failed" },
          { status: res.status },
        );
      }

      return NextResponse.json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        identity: identityFromTokenData(data),
      });
    } catch {
      return NextResponse.json(
        { error: "Could not reach auth server" },
        { status: 503 },
      );
    }
  }

  // Device code poll flow
  if (!body.deviceAuthId || !body.userCode) {
    return NextResponse.json(
      { error: "Missing deviceAuthId or userCode" },
      { status: 400 },
    );
  }

  try {
    // Poll the device auth token endpoint
    const pollRes = await fetch(CODEX_DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: body.deviceAuthId,
        user_code: body.userCode,
      }),
    });

    // 403/404 = user hasn't authorized yet
    if (pollRes.status === 403 || pollRes.status === 404) {
      return NextResponse.json({ status: "pending" });
    }

    if (!pollRes.ok) {
      return NextResponse.json(
        { error: "Device auth failed", status: "error" },
        { status: pollRes.status },
      );
    }

    // Success - got authorization code + PKCE from server
    const pollData = await pollRes.json();
    const { authorization_code, code_verifier } = pollData;

    if (!authorization_code || !code_verifier) {
      return NextResponse.json(
        { error: "Unexpected response from device auth", status: "error" },
        { status: 500 },
      );
    }

    // Exchange authorization code for tokens
    const tokenRes = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorization_code,
        redirect_uri: CODEX_DEVICE_AUTH_REDIRECT,
        client_id: CODEX_CLIENT_ID,
        code_verifier,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: tokenData.error_description || "Token exchange failed", status: "error" },
        { status: tokenRes.status },
      );
    }

    return NextResponse.json({
      status: "success",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      identity: identityFromTokenData(tokenData),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach auth server", status: "error" },
      { status: 503 },
    );
  }
}
