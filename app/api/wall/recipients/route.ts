import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllowedRecipients } from "@/lib/wall-recipients";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const recipients = await getAllowedRecipients(user);
    return NextResponse.json({ recipients });
  } catch (e) {
    console.error("wall recipients GET failed", e);
    return NextResponse.json({ error: "Failed to load recipients" }, { status: 500 });
  }
}
