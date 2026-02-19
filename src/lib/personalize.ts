import { BabyName } from "./names";
import { Rating } from "./redis";

interface PatternAnalysis {
  preferredSyllables: number[];
  preferredOrigins: string[];
  preferredEndings: string[];
  avoidedEndings: string[];
  preferredLength: "short" | "medium" | "long";
}

function getEnding(name: string): string {
  return name.slice(-2).toLowerCase();
}

function analyzePatterns(
  names: BabyName[],
  ratings: Record<string, Rating>
): PatternAnalysis {
  const loved: BabyName[] = [];
  const passed: BabyName[] = [];

  for (const name of names) {
    const rating = ratings[name.name];
    if (rating === "love") loved.push(name);
    else if (rating === "pass") passed.push(name);
  }

  // Syllable preferences
  const syllableCounts: Record<number, number> = {};
  for (const n of loved) {
    syllableCounts[n.syllables] = (syllableCounts[n.syllables] || 0) + 1;
  }
  for (const n of passed) {
    syllableCounts[n.syllables] = (syllableCounts[n.syllables] || 0) - 0.5;
  }
  const preferredSyllables = Object.entries(syllableCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([s]) => parseInt(s));

  // Origin preferences
  const originCounts: Record<string, number> = {};
  for (const n of loved) {
    const origins = n.origin.split("/").map((o) => o.trim());
    for (const o of origins) {
      originCounts[o] = (originCounts[o] || 0) + 1;
    }
  }
  for (const n of passed) {
    const origins = n.origin.split("/").map((o) => o.trim());
    for (const o of origins) {
      originCounts[o] = (originCounts[o] || 0) - 0.5;
    }
  }
  const preferredOrigins = Object.entries(originCounts)
    .sort(([, a], [, b]) => b - a)
    .filter(([, v]) => v > 0)
    .slice(0, 4)
    .map(([o]) => o);

  // Ending preferences
  const endingCounts: Record<string, number> = {};
  for (const n of loved) {
    const ending = getEnding(n.name);
    endingCounts[ending] = (endingCounts[ending] || 0) + 1;
  }
  const passedEndings: Record<string, number> = {};
  for (const n of passed) {
    const ending = getEnding(n.name);
    passedEndings[ending] = (passedEndings[ending] || 0) + 1;
  }
  const preferredEndings = Object.entries(endingCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([e]) => e);
  const avoidedEndings = Object.entries(passedEndings)
    .filter(([e]) => !preferredEndings.includes(e))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([e]) => e);

  // Length preference
  const avgLength =
    loved.reduce((sum, n) => sum + n.name.length, 0) / (loved.length || 1);
  const preferredLength: "short" | "medium" | "long" =
    avgLength < 5 ? "short" : avgLength < 7 ? "medium" : "long";

  return {
    preferredSyllables,
    preferredOrigins,
    preferredEndings,
    avoidedEndings,
    preferredLength,
  };
}

function scoreName(name: BabyName, patterns: PatternAnalysis): number {
  let score = 0;

  // Syllable match
  if (patterns.preferredSyllables.includes(name.syllables)) {
    score += 3;
  }

  // Origin match
  const origins = name.origin.split("/").map((o) => o.trim());
  for (const o of origins) {
    if (patterns.preferredOrigins.includes(o)) {
      score += 2;
    }
  }

  // Ending match
  const ending = getEnding(name.name);
  if (patterns.preferredEndings.includes(ending)) {
    score += 2;
  }
  if (patterns.avoidedEndings.includes(ending)) {
    score -= 2;
  }

  // Length match
  const length = name.name.length;
  if (
    patterns.preferredLength === "short" &&
    length < 5
  ) score += 1;
  else if (
    patterns.preferredLength === "medium" &&
    length >= 5 &&
    length < 7
  ) score += 1;
  else if (
    patterns.preferredLength === "long" &&
    length >= 7
  ) score += 1;

  return score;
}

// This is the local heuristic version. Can be replaced with a Claude API call later.
// To wire up Claude: send loved/passed names + unrated names, ask it to re-rank.
export function personalizeNameOrder(
  allNames: BabyName[],
  ratings: Record<string, Rating>,
  currentOrder: string[]
): string[] {
  const ratedCount = Object.keys(ratings).length;
  if (ratedCount < 20) return currentOrder;

  const patterns = analyzePatterns(allNames, ratings);
  const unrated = currentOrder.filter((name) => !ratings[name]);
  const rated = currentOrder.filter((name) => ratings[name]);

  const nameMap = new Map(allNames.map((n) => [n.name, n]));
  const scored = unrated
    .map((name) => ({
      name,
      score: nameMap.has(name) ? scoreName(nameMap.get(name)!, patterns) : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.name);

  return [...rated, ...scored];
}

// Placeholder for Claude API integration
// export async function personalizeWithClaude(
//   lovedNames: BabyName[],
//   passedNames: BabyName[],
//   unratedNames: BabyName[]
// ): Promise<string[]> {
//   // Call Claude API with:
//   // - Loved names and their attributes
//   // - Passed names and their attributes
//   // - Unrated names to re-rank
//   // Return re-ranked name order
//   throw new Error("Not implemented - wire up Claude API key");
// }
