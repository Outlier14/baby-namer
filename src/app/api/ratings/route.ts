import { NextRequest, NextResponse } from "next/server";
import redis, { getUserKey, UserProgress, Rating } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user, name, rating } = body as {
    user: string;
    name: string;
    rating: Rating;
  };

  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }
  if (!name || !["love", "maybe", "pass"].includes(rating)) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  const data = await redis.get<UserProgress>(key);
  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  data.ratings[name] = rating;
  data.currentIndex = Math.min(data.currentIndex + 1, data.nameOrder.length);
  data.lastUpdated = Date.now();
  await redis.set(key, data);

  return NextResponse.json({ ok: true, currentIndex: data.currentIndex });
}

// Undo last rating
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { user, name } = body as { user: string; name: string };

  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  const data = await redis.get<UserProgress>(key);
  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  delete data.ratings[name];
  data.currentIndex = Math.max(data.currentIndex - 1, 0);
  data.lastUpdated = Date.now();
  await redis.set(key, data);

  return NextResponse.json({ ok: true, currentIndex: data.currentIndex });
}
