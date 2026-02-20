import { Redis } from "@upstash/redis";

// In development, use REST API. In production on Vercel, same.
// Environment variables: KV_REST_API_URL and KV_REST_API_TOKEN
const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export default redis;

export type Rating = "love" | "maybe" | "pass";

export interface UserProgress {
  currentIndex: number;
  nameOrder: string[]; // shuffled name list
  ratings: Record<string, Rating>;
  customNames: Array<{
    name: string;
    origin?: string;
    meaning?: string;
    phonetic?: string;
    nicknames?: string[];
  }>;
  personalizationEnabled: boolean;
  lastUpdated: number;
  // Tutorial
  hasSeenTutorial?: boolean;
  // Middle name phase
  phase?: "first" | "middle";
  topFirstNames?: string[];
  middleNameRatings?: Record<string, Record<string, Rating>>; // { "Sophia": { "Rose": "love" } }
  middleNameOrder?: string[];
  middleNameIndex?: number;
  activeFirstName?: string | null;
}

export const defaultProgress = (nameOrder: string[]): UserProgress => ({
  currentIndex: 0,
  nameOrder,
  ratings: {},
  customNames: [],
  personalizationEnabled: false,
  lastUpdated: Date.now(),
});

export function getUserKey(user: string): string {
  return `babynamer:${user}`;
}
