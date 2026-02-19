import { NextResponse } from "next/server";
import redis, { getUserKey, UserProgress } from "@/lib/redis";

export async function GET() {
  const nickData = await redis.get<UserProgress>(getUserKey("nick"));
  const nickiData = await redis.get<UserProgress>(getUserKey("nicki"));

  if (!nickData || !nickiData) {
    return NextResponse.json({ bothLoved: [], oneLovedOneMaybe: [], bothMaybe: [] });
  }

  const nickRatings = nickData.ratings;
  const nickiRatings = nickiData.ratings;

  const allNames = new Set([
    ...Object.keys(nickRatings),
    ...Object.keys(nickiRatings),
  ]);

  const bothLoved: string[] = [];
  const oneLovedOneMaybe: string[] = [];
  const bothMaybe: string[] = [];

  for (const name of allNames) {
    const nr = nickRatings[name];
    const nir = nickiRatings[name];
    if (!nr || !nir) continue;

    if (nr === "love" && nir === "love") {
      bothLoved.push(name);
    } else if (
      (nr === "love" && nir === "maybe") ||
      (nr === "maybe" && nir === "love")
    ) {
      oneLovedOneMaybe.push(name);
    } else if (nr === "maybe" && nir === "maybe") {
      bothMaybe.push(name);
    }
  }

  return NextResponse.json({ bothLoved, oneLovedOneMaybe, bothMaybe });
}
