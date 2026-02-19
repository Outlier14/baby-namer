import { NextRequest, NextResponse } from "next/server";
import redis, { getUserKey, UserProgress } from "@/lib/redis";
import names from "@/lib/names";
import { personalizeNameOrder } from "@/lib/personalize";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user } = body as { user: string };

  if (!user || !["nick", "nicki"].includes(user.toLowerCase())) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const key = getUserKey(user.toLowerCase());
  const data = await redis.get<UserProgress>(key);
  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const ratedCount = Object.keys(data.ratings).length;
  if (ratedCount < 20) {
    return NextResponse.json({
      ok: false,
      message: "Need at least 20 ratings to personalize",
    });
  }

  const newOrder = personalizeNameOrder(names, data.ratings, data.nameOrder);
  data.nameOrder = newOrder;
  data.personalizationEnabled = true;
  data.lastUpdated = Date.now();
  await redis.set(key, data);

  return NextResponse.json({ ok: true, personalized: true });
}
