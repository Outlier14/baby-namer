import { NextRequest, NextResponse } from "next/server";
import redis, { getUserKey, defaultProgress, UserProgress } from "@/lib/redis";
import names from "@/lib/names";

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user");
  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  const data = await redis.get<UserProgress>(key);

  if (data) {
    return NextResponse.json(data);
  }

  // First time: create shuffled order
  const nameOrder = shuffleArray(names.map((n) => n.name));
  const progress = defaultProgress(nameOrder);
  await redis.set(key, progress);
  return NextResponse.json(progress);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user, progress } = body as { user: string; progress: UserProgress };

  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  progress.lastUpdated = Date.now();
  await redis.set(key, progress);
  return NextResponse.json({ ok: true });
}
