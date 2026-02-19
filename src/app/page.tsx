"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BabyName } from "@/lib/names";
import type { UserProgress, Rating } from "@/lib/redis";

type View = "welcome" | "rate" | "shortlist" | "compare" | "addName";

// All names loaded client-side for card display
let allNamesCache: BabyName[] | null = null;
async function loadNames(): Promise<BabyName[]> {
  if (allNamesCache) return allNamesCache;
  const mod = await import("@/lib/names");
  allNamesCache = mod.default;
  return allNamesCache;
}

function renderNameWithHighlight(name: string, context: "card" | "fullname") {
  if (context === "fullname") {
    const startsWithJ = name.startsWith("J");
    const nameEl = renderNameLetters(name);
    const lastNameEl = startsWithJ ? (
      <span>
        <span className="name-letter-j">J</span>anszyn
      </span>
    ) : (
      <span>Janszyn</span>
    );
    return (
      <span>
        {nameEl} {lastNameEl}
      </span>
    );
  }
  return renderNameLetters(name);
}

function renderNameLetters(name: string) {
  if (name.startsWith("N")) {
    return (
      <span>
        <span className="name-letter-n">N</span>
        {name.slice(1)}
      </span>
    );
  }
  if (name.startsWith("J")) {
    return (
      <span>
        <span className="name-letter-j">J</span>
        {name.slice(1)}
      </span>
    );
  }
  return <span>{name}</span>;
}

function speak(name: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(name);
    utter.rate = 0.9;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }
}

export default function Home() {
  const [view, setView] = useState<View>("welcome");
  const [user, setUser] = useState<string | null>(null);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [allNames, setAllNames] = useState<BabyName[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, BabyName>>(new Map());
  const [loading, setLoading] = useState(false);
  const [swipeClass, setSwipeClass] = useState("");
  const [showSimilar, setShowSimilar] = useState(false);
  const [compareData, setCompareData] = useState<{
    bothLoved: string[];
    oneLovedOneMaybe: string[];
    bothMaybe: string[];
  } | null>(null);
  const [lastRatedName, setLastRatedName] = useState<string | null>(null);
  const [personalizationBanner, setPersonalizationBanner] = useState(false);
  const [addNameForm, setAddNameForm] = useState({
    name: "",
    origin: "",
    meaning: "",
    phonetic: "",
    nicknames: "",
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Touch handling
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNames().then((n) => {
      setAllNames(n);
      setNameMap(new Map(n.map((name) => [name.name, name])));
    });
  }, []);

  const selectUser = async (u: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user?user=${u}`);
      const data = await res.json();
      setUser(u);
      setProgress(data);
      setView("rate");
    } catch {
      // Fallback: work offline with local state
      const names = await loadNames();
      const shuffled = [...names.map((n) => n.name)].sort(
        () => Math.random() - 0.5
      );
      setUser(u);
      setProgress({
        currentIndex: 0,
        nameOrder: shuffled,
        ratings: {},
        customNames: [],
        personalizationEnabled: false,
        lastUpdated: Date.now(),
      });
      setView("rate");
    }
    setLoading(false);
  };

  const saveProgress = useCallback(
    async (updatedProgress: UserProgress) => {
      if (!user) return;
      setProgress(updatedProgress);
      try {
        await fetch("/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user, progress: updatedProgress }),
        });
      } catch {
        // Offline: just keep local state
      }
    },
    [user]
  );

  const currentName = progress
    ? progress.nameOrder[progress.currentIndex]
    : null;
  const currentNameData = currentName ? nameMap.get(currentName) : null;
  const customNameData =
    currentName && !currentNameData
      ? progress?.customNames.find((n) => n.name === currentName)
      : null;

  const rateName = useCallback(
    async (rating: Rating, direction: "left" | "right" | "up") => {
      if (!progress || !currentName || !user) return;

      setLastRatedName(currentName);

      // Animate
      if (direction === "left") setSwipeClass("swipe-left");
      else if (direction === "right") setSwipeClass("swipe-right");
      else setSwipeClass("swipe-up");

      setTimeout(async () => {
        setSwipeClass("");
        setShowSimilar(false);

        const newRatings = { ...progress.ratings, [currentName]: rating };
        const newIndex = Math.min(
          progress.currentIndex + 1,
          progress.nameOrder.length
        );
        const updated = {
          ...progress,
          ratings: newRatings,
          currentIndex: newIndex,
          lastUpdated: Date.now(),
        };

        await saveProgress(updated);

        // Save rating to server
        try {
          await fetch("/api/ratings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user, name: currentName, rating }),
          });
        } catch {
          // Offline fallback
        }

        // Check personalization
        const ratedCount = Object.keys(newRatings).length;
        if (ratedCount === 20 && !progress.personalizationEnabled) {
          try {
            const res = await fetch("/api/personalize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user }),
            });
            const data = await res.json();
            if (data.personalized) {
              setPersonalizationBanner(true);
              // Refresh progress to get new order
              const userRes = await fetch(`/api/user?user=${user}`);
              const userData = await userRes.json();
              setProgress(userData);
              setTimeout(() => setPersonalizationBanner(false), 5000);
            }
          } catch {
            // Non-critical
          }
        }
      }, 300);
    },
    [progress, currentName, user, saveProgress]
  );

  const undoLastRating = useCallback(async () => {
    if (!progress || !lastRatedName || !user) return;

    const newRatings = { ...progress.ratings };
    delete newRatings[lastRatedName];
    const newIndex = Math.max(progress.currentIndex - 1, 0);
    const updated = {
      ...progress,
      ratings: newRatings,
      currentIndex: newIndex,
      lastUpdated: Date.now(),
    };
    await saveProgress(updated);
    setLastRatedName(null);

    try {
      await fetch("/api/ratings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, name: lastRatedName }),
      });
    } catch {
      // Offline fallback
    }
  }, [progress, lastRatedName, user, saveProgress]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < 50 && absDy < 50) {
      touchStart.current = null;
      return;
    }

    if (absDy > absDx && dy < -50) {
      rateName("maybe", "up");
    } else if (absDx > absDy) {
      if (dx > 50) rateName("love", "right");
      else if (dx < -50) rateName("pass", "left");
    }
    touchStart.current = null;
  };

  const addToFavorites = async (name: string) => {
    if (!progress || !user) return;
    const newRatings = { ...progress.ratings, [name]: "love" as Rating };
    const updated = { ...progress, ratings: newRatings, lastUpdated: Date.now() };
    await saveProgress(updated);
    try {
      await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, name, rating: "love" }),
      });
    } catch {
      // Offline
    }
  };

  const removeFromShortlist = async (name: string) => {
    if (!progress || !user) return;
    const newRatings = { ...progress.ratings };
    delete newRatings[name];
    const updated = { ...progress, ratings: newRatings, lastUpdated: Date.now() };
    await saveProgress(updated);
  };

  const exportShortlist = () => {
    if (!progress) return;
    const loves = Object.entries(progress.ratings)
      .filter(([, r]) => r === "love")
      .map(([n]) => n);
    const maybes = Object.entries(progress.ratings)
      .filter(([, r]) => r === "maybe")
      .map(([n]) => n);
    const text = `Baby Namer - ${user}'s Shortlist\n\nLoves:\n${loves.join(
      "\n"
    )}\n\nMaybes:\n${maybes.join("\n")}`;
    navigator.clipboard.writeText(text);
    alert("Shortlist copied to clipboard!");
  };

  const loadCompare = async () => {
    try {
      const res = await fetch("/api/compare");
      const data = await res.json();
      setCompareData(data);
    } catch {
      setCompareData({ bothLoved: [], oneLovedOneMaybe: [], bothMaybe: [] });
    }
    setView("compare");
  };

  const submitAddName = async () => {
    if (!user || !addNameForm.name.trim()) return;
    try {
      await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user,
          name: addNameForm.name.trim(),
          origin: addNameForm.origin || undefined,
          meaning: addNameForm.meaning || undefined,
          phonetic: addNameForm.phonetic || undefined,
          nicknames: addNameForm.nicknames
            ? addNameForm.nicknames.split(",").map((n) => n.trim())
            : undefined,
        }),
      });
      // Refresh progress
      const res = await fetch(`/api/user?user=${user}`);
      const data = await res.json();
      setProgress(data);
    } catch {
      // Offline: add locally
      if (progress) {
        const newOrder = [...progress.nameOrder];
        newOrder.splice(progress.currentIndex, 0, addNameForm.name.trim());
        const updated = {
          ...progress,
          nameOrder: newOrder,
          customNames: [
            ...progress.customNames,
            {
              name: addNameForm.name.trim(),
              origin: addNameForm.origin || undefined,
              meaning: addNameForm.meaning || undefined,
              phonetic: addNameForm.phonetic || undefined,
              nicknames: addNameForm.nicknames
                ? addNameForm.nicknames.split(",").map((n) => n.trim())
                : undefined,
            },
          ],
          lastUpdated: Date.now(),
        };
        setProgress(updated);
      }
    }
    setAddNameForm({ name: "", origin: "", meaning: "", phonetic: "", nicknames: "" });
    setView("rate");
  };

  // Stats
  const totalNames = progress?.nameOrder.length || 0;
  const ratedCount = progress ? Object.keys(progress.ratings).length : 0;
  const loveCount = progress
    ? Object.values(progress.ratings).filter((r) => r === "love").length
    : 0;
  const maybeCount = progress
    ? Object.values(progress.ratings).filter((r) => r === "maybe").length
    : 0;
  const remaining = totalNames - ratedCount;

  // ===== WELCOME SCREEN =====
  if (view === "welcome") {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-6">
        <div className="text-center mb-12">
          <h1
            className="text-5xl font-light tracking-wide mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Baby Namer
          </h1>
          <p className="text-gray-500 text-sm tracking-widest uppercase">
            Find her perfect name
          </p>
        </div>
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button
            onClick={() => selectUser("nick")}
            disabled={loading}
            className="w-full py-4 px-8 bg-white/90 backdrop-blur-sm rounded-2xl card-shadow text-lg font-medium text-gray-800 hover:bg-white transition-all active:scale-[0.98]"
            style={{ fontFamily: "var(--font-heading)", fontSize: "1.3rem" }}
          >
            {loading ? "Loading..." : "I'm Nick"}
          </button>
          <button
            onClick={() => selectUser("nicki")}
            disabled={loading}
            className="w-full py-4 px-8 bg-white/90 backdrop-blur-sm rounded-2xl card-shadow text-lg font-medium text-gray-800 hover:bg-white transition-all active:scale-[0.98]"
            style={{ fontFamily: "var(--font-heading)", fontSize: "1.3rem" }}
          >
            {loading ? "Loading..." : "I'm Nicki"}
          </button>
        </div>
      </div>
    );
  }

  // ===== RATING VIEW =====
  if (view === "rate") {
    const isDone = progress && progress.currentIndex >= progress.nameOrder.length;

    return (
      <div className="flex flex-col min-h-dvh">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/60 backdrop-blur-sm text-gray-600"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {user === "nick" ? "Nick" : "Nicki"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{ratedCount} rated</span>
            <span className="text-red-400">{loveCount} loved</span>
            <span className="text-amber-500">{maybeCount} maybe</span>
          </div>
          {lastRatedName && (
            <button
              onClick={undoLastRating}
              className="text-xs text-purple-500 font-medium"
            >
              Undo
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-4 mb-2">
          <div className="h-1 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pink-400 to-purple-400 rounded-full transition-all duration-300"
              style={{ width: `${totalNames > 0 ? (ratedCount / totalNames) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1 text-right">
            {remaining} remaining
          </p>
        </div>

        {/* Personalization banner */}
        {personalizationBanner && (
          <div className="mx-4 mb-2 py-2 px-4 bg-purple-100 rounded-xl text-xs text-purple-700 text-center">
            We&apos;ve personalized your remaining names based on your ratings.
          </div>
        )}

        {/* Menu dropdown */}
        {menuOpen && (
          <div className="absolute top-16 left-4 z-50 bg-white rounded-2xl card-shadow py-2 min-w-[180px]">
            <button
              onClick={() => {
                setMenuOpen(false);
                setView("shortlist");
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            >
              My Shortlist
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                loadCompare();
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            >
              Compare with Partner
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setView("addName");
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
            >
              Add a Name
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setUser(null);
                setProgress(null);
                setView("welcome");
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-400 hover:bg-gray-50 border-t border-gray-100"
            >
              Switch User
            </button>
          </div>
        )}
        {menuOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
        )}

        {/* Card area */}
        <div className="flex-1 flex items-center justify-center px-4 pb-2">
          {isDone ? (
            <div className="text-center">
              <h2
                className="text-3xl font-light mb-4"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                All Done!
              </h2>
              <p className="text-gray-500 text-sm mb-6">
                You&apos;ve rated all {totalNames} names.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setView("shortlist")}
                  className="py-3 px-6 bg-white rounded-2xl card-shadow text-sm font-medium"
                >
                  View Shortlist ({loveCount} loves, {maybeCount} maybes)
                </button>
                <button
                  onClick={loadCompare}
                  className="py-3 px-6 bg-white rounded-2xl card-shadow text-sm font-medium"
                >
                  Compare with Partner
                </button>
              </div>
            </div>
          ) : currentName ? (
            <div
              ref={cardRef}
              className={`w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-3xl card-shadow p-6 ${swipeClass || "card-enter"}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Name */}
              <div className="text-center mb-4">
                <h2
                  className="text-4xl font-semibold mb-1"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {renderNameWithHighlight(currentName, "card")}
                </h2>
                <p
                  className="text-lg text-gray-400 font-light"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {renderNameWithHighlight(currentName, "fullname")}
                </p>
              </div>

              {/* Phonetic + speaker */}
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="text-sm text-gray-400 italic">
                  {currentNameData?.phonetic || customNameData?.phonetic || ""}
                </span>
                <button
                  onClick={() => speak(currentName)}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                </button>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Origin</span>
                  <span className="text-gray-700 font-medium">
                    {currentNameData?.origin || customNameData?.origin || "—"}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Meaning</span>
                  <span className="text-gray-700 font-medium">
                    {currentNameData?.meaning || customNameData?.meaning || "—"}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Syllables</span>
                  <span className="text-gray-700 font-medium">
                    {currentNameData?.syllables || "—"}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Nicknames</span>
                  <span className="text-gray-700 font-medium">
                    {(currentNameData?.nicknames || customNameData?.nicknames || []).join(
                      ", "
                    ) || "—"}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Peak Era</span>
                  <span className="text-gray-700 font-medium">
                    {currentNameData?.peakDecades?.join(", ") || "—"}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <span className="text-gray-400 block mb-0.5">Top State</span>
                  <span className="text-gray-700 font-medium">
                    {currentNameData?.popularState || "—"}
                  </span>
                </div>
              </div>

              {/* Similar names */}
              {currentNameData?.similarNames &&
                currentNameData.similarNames.length > 0 && (
                  <div className="mb-2">
                    <button
                      onClick={() => setShowSimilar(!showSimilar)}
                      className="text-xs text-purple-500 font-medium"
                    >
                      {showSimilar ? "Hide" : "Similar names"}
                    </button>
                    {showSimilar && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {currentNameData.similarNames.map((sn) => (
                          <button
                            key={sn}
                            onClick={() => addToFavorites(sn)}
                            className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors"
                          >
                            {sn} +
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          ) : (
            <div className="text-gray-400 text-sm">Loading...</div>
          )}
        </div>

        {/* Rating buttons */}
        {!isDone && currentName && (
          <div className="flex items-center justify-center gap-6 pb-8 pt-2">
            <button
              onClick={() => rateName("pass", "left")}
              className="w-16 h-16 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm card-shadow text-gray-400 hover:bg-white hover:text-red-400 transition-all active:scale-95 text-2xl"
            >
              ✕
            </button>
            <button
              onClick={() => rateName("maybe", "up")}
              className="w-14 h-14 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm card-shadow text-gray-400 hover:bg-white hover:text-amber-500 transition-all active:scale-95 text-xl"
            >
              🤔
            </button>
            <button
              onClick={() => rateName("love", "right")}
              className="w-16 h-16 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm card-shadow text-gray-400 hover:bg-white hover:text-pink-500 transition-all active:scale-95 text-2xl"
            >
              ❤️
            </button>
          </div>
        )}

        {/* Swipe hint */}
        {ratedCount === 0 && currentName && !isDone && (
          <p className="text-center text-[10px] text-gray-400 pb-4 -mt-4">
            Swipe right to love, left to pass, up for maybe
          </p>
        )}
      </div>
    );
  }

  // ===== SHORTLIST VIEW =====
  if (view === "shortlist") {
    const loves = progress
      ? Object.entries(progress.ratings)
          .filter(([, r]) => r === "love")
          .map(([n]) => n)
      : [];
    const maybes = progress
      ? Object.entries(progress.ratings)
          .filter(([, r]) => r === "maybe")
          .map(([n]) => n)
      : [];

    return (
      <div className="min-h-dvh flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            onClick={() => setView("rate")}
            className="text-sm text-purple-500 font-medium"
          >
            ← Back
          </button>
          <h2
            className="text-lg font-medium"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {user === "nick" ? "Nick" : "Nicki"}&apos;s Shortlist
          </h2>
          <button
            onClick={exportShortlist}
            className="text-sm text-purple-500 font-medium"
          >
            Export
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {loves.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Loves ({loves.length})
              </h3>
              {loves.map((name) => {
                const data = nameMap.get(name);
                return (
                  <div
                    key={name}
                    className="bg-white/90 backdrop-blur-sm rounded-2xl card-shadow p-4 mb-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span
                          className="text-xl font-semibold"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {renderNameWithHighlight(name, "card")}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          {renderNameWithHighlight(name, "fullname")}
                        </span>
                      </div>
                      <button
                        onClick={() => removeFromShortlist(name)}
                        className="text-gray-300 hover:text-red-400 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                    {data && (
                      <div className="text-xs text-gray-500">
                        <span>{data.origin}</span>
                        <span className="mx-1">·</span>
                        <span>{data.meaning}</span>
                        <span className="mx-1">·</span>
                        <span>{data.syllables} syl</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {maybes.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Maybes ({maybes.length})
              </h3>
              {maybes.map((name) => {
                const data = nameMap.get(name);
                return (
                  <div
                    key={name}
                    className="bg-white/70 backdrop-blur-sm rounded-2xl card-shadow p-4 mb-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span
                          className="text-xl font-semibold"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {renderNameWithHighlight(name, "card")}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          {renderNameWithHighlight(name, "fullname")}
                        </span>
                      </div>
                      <button
                        onClick={() => removeFromShortlist(name)}
                        className="text-gray-300 hover:text-red-400 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                    {data && (
                      <div className="text-xs text-gray-500">
                        <span>{data.origin}</span>
                        <span className="mx-1">·</span>
                        <span>{data.meaning}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {loves.length === 0 && maybes.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-20">
              No names in your shortlist yet. Start rating!
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== COMPARE VIEW =====
  if (view === "compare") {
    return (
      <div className="min-h-dvh flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            onClick={() => setView("rate")}
            className="text-sm text-purple-500 font-medium"
          >
            ← Back
          </button>
          <h2
            className="text-lg font-medium"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Partner Match
          </h2>
          <div className="w-12" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {!compareData ? (
            <div className="text-center text-gray-400 text-sm mt-20">
              Loading...
            </div>
          ) : (
            <>
              {compareData.bothLoved.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-pink-500 uppercase tracking-wider mb-3">
                    Both Loved ❤️❤️ ({compareData.bothLoved.length})
                  </h3>
                  {compareData.bothLoved.map((name) => {
                    const data = nameMap.get(name);
                    return (
                      <div
                        key={name}
                        className="bg-white/95 backdrop-blur-sm rounded-2xl card-shadow p-4 mb-3 border-l-4 border-pink-400"
                      >
                        <span
                          className="text-xl font-semibold"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {renderNameWithHighlight(name, "card")}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          {renderNameWithHighlight(name, "fullname")}
                        </span>
                        {data && (
                          <div className="text-xs text-gray-500 mt-2">
                            <span>{data.origin}</span>
                            <span className="mx-1">·</span>
                            <span>{data.meaning}</span>
                            <span className="mx-1">·</span>
                            <span>{data.phonetic}</span>
                            <span className="mx-1">·</span>
                            <span>{data.syllables} syl</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {compareData.oneLovedOneMaybe.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-3">
                    One Love, One Maybe ❤️🤔 ({compareData.oneLovedOneMaybe.length})
                  </h3>
                  {compareData.oneLovedOneMaybe.map((name) => {
                    const data = nameMap.get(name);
                    return (
                      <div
                        key={name}
                        className="bg-white/90 backdrop-blur-sm rounded-2xl card-shadow p-4 mb-3 border-l-4 border-amber-400"
                      >
                        <span
                          className="text-xl font-semibold"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {renderNameWithHighlight(name, "card")}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          {renderNameWithHighlight(name, "fullname")}
                        </span>
                        {data && (
                          <div className="text-xs text-gray-500 mt-2">
                            <span>{data.origin}</span>
                            <span className="mx-1">·</span>
                            <span>{data.meaning}</span>
                            <span className="mx-1">·</span>
                            <span>{data.syllables} syl</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {compareData.bothMaybe.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Both Maybe 🤔🤔 ({compareData.bothMaybe.length})
                  </h3>
                  {compareData.bothMaybe.map((name) => {
                    const data = nameMap.get(name);
                    return (
                      <div
                        key={name}
                        className="bg-white/70 backdrop-blur-sm rounded-2xl card-shadow p-4 mb-3 border-l-4 border-gray-300"
                      >
                        <span
                          className="text-xl font-semibold"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {renderNameWithHighlight(name, "card")}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          {renderNameWithHighlight(name, "fullname")}
                        </span>
                        {data && (
                          <div className="text-xs text-gray-500 mt-2">
                            <span>{data.origin}</span>
                            <span className="mx-1">·</span>
                            <span>{data.meaning}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {compareData.bothLoved.length === 0 &&
                compareData.oneLovedOneMaybe.length === 0 &&
                compareData.bothMaybe.length === 0 && (
                  <div className="text-center text-gray-400 text-sm mt-20">
                    <p className="mb-2">No matches yet.</p>
                    <p>Both partners need to rate more names first.</p>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ===== ADD NAME VIEW =====
  if (view === "addName") {
    return (
      <div className="min-h-dvh flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            onClick={() => setView("rate")}
            className="text-sm text-purple-500 font-medium"
          >
            ← Back
          </button>
          <h2
            className="text-lg font-medium"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Add a Name
          </h2>
          <div className="w-12" />
        </div>

        <div className="flex-1 px-4 pt-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl card-shadow p-6">
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                  Name *
                </label>
                <input
                  type="text"
                  value={addNameForm.name}
                  onChange={(e) =>
                    setAddNameForm({ ...addNameForm, name: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 rounded-xl text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="Enter a name"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                  Origin
                </label>
                <input
                  type="text"
                  value={addNameForm.origin}
                  onChange={(e) =>
                    setAddNameForm({ ...addNameForm, origin: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 rounded-xl text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="e.g. Ukrainian"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                  Meaning
                </label>
                <input
                  type="text"
                  value={addNameForm.meaning}
                  onChange={(e) =>
                    setAddNameForm({ ...addNameForm, meaning: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 rounded-xl text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="e.g. Beautiful dawn"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                  Phonetic spelling
                </label>
                <input
                  type="text"
                  value={addNameForm.phonetic}
                  onChange={(e) =>
                    setAddNameForm({ ...addNameForm, phonetic: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 rounded-xl text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="e.g. ZAR-ah"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                  Nicknames (comma separated)
                </label>
                <input
                  type="text"
                  value={addNameForm.nicknames}
                  onChange={(e) =>
                    setAddNameForm({
                      ...addNameForm,
                      nicknames: e.target.value,
                    })
                  }
                  className="w-full px-4 py-3 bg-gray-50 rounded-xl text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="e.g. Zar, Zari"
                />
              </div>

              <button
                onClick={submitAddName}
                disabled={!addNameForm.name.trim()}
                className="w-full py-3 bg-gradient-to-r from-pink-400 to-purple-400 text-white rounded-xl font-medium text-sm disabled:opacity-40 transition-opacity"
              >
                Add Name
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
