import { NextRequest, NextResponse } from "next/server";
import redis, { getUserKey, UserProgress } from "@/lib/redis";

// Add a custom name to user's stack
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user, name, origin, meaning, phonetic, nicknames } = body as {
    user: string;
    name: string;
    origin?: string;
    meaning?: string;
    phonetic?: string;
    nicknames?: string[];
  };

  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }
  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  const data = await redis.get<UserProgress>(key);
  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Add to custom names
  data.customNames.push({
    name: name.trim(),
    origin: origin?.trim(),
    meaning: meaning?.trim(),
    phonetic: phonetic?.trim(),
    nicknames: nicknames || [],
  });

  // Insert right after current position so it shows up next
  const insertAt = data.currentIndex;
  data.nameOrder.splice(insertAt, 0, name.trim());

  data.lastUpdated = Date.now();
  await redis.set(key, data);

  return NextResponse.json({ ok: true });
}
