import { NextResponse } from "next/server";
import { CODEX_CLIENT_ID, CODEX_DEVICE_USERCODE_URL } from "@/lib/codex-auth";

export async function POST() {
  try {
    const res = await fetch(CODEX_DEVICE_USERCODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Failed to start device auth: ${text}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code || data.usercode,
      interval: parseInt(data.interval, 10) || 5,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach OpenAI auth server" },
      { status: 503 },
    );
  }
}
