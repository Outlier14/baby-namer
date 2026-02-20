"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BabyName } from "@/lib/names";
import type { UserProgress, Rating } from "@/lib/redis";

type View = "welcome" | "rate" | "shortlist" | "compare" | "addName";

let allNamesCache: BabyName[] | null = null;
async function loadNames(): Promise<BabyName[]> {
  if (allNamesCache) return allNamesCache;
  const mod = await import("@/lib/names");
  allNamesCache = mod.default;
  return allNamesCache;
}

// Material icon helper
function Icon({ name, filled, size, className, style }: { name: string; filled?: boolean; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`material-symbols-rounded ${filled ? "filled" : ""} ${className || ""}`}
      style={{ ...(size ? { fontSize: size } : {}), ...style }}
    >
      {name}
    </span>
  );
}

function renderNameWithHighlight(name: string, context: "card" | "fullname") {
  if (context === "fullname") {
    const startsWithJ = name.startsWith("J");
    const nameEl = renderNameLetters(name);
    const lastNameEl = startsWithJ ? (
      <span><span className="name-letter-j">J</span>anszyn</span>
    ) : (
      <span>Janszyn</span>
    );
    return <span>{nameEl} {lastNameEl}</span>;
  }
  return renderNameLetters(name);
}

function renderNameLetters(name: string) {
  if (name.startsWith("N")) {
    return <span><span className="name-letter-n">N</span>{name.slice(1)}</span>;
  }
  if (name.startsWith("J")) {
    return <span><span className="name-letter-j">J</span>{name.slice(1)}</span>;
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

// localStorage helpers for offline-first persistence
function saveLocal(key: string, data: UserProgress) {
  try { localStorage.setItem(`babynamer_${key}`, JSON.stringify(data)); } catch { /* full */ }
}
function loadLocal(key: string): UserProgress | null {
  try {
    const raw = localStorage.getItem(`babynamer_${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function Home() {
  const [view, setView] = useState<View>("welcome");
  const [user, setUser] = useState<string | null>(null);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [, setAllNames] = useState<BabyName[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, BabyName>>(new Map());
  const [loading, setLoading] = useState(false);
  const [swipeClass, setSwipeClass] = useState("");
  const [compareData, setCompareData] = useState<{
    bothLoved: string[];
    oneLovedOneMaybe: string[];
    bothMaybe: string[];
  } | null>(null);
  const [lastRatedName, setLastRatedName] = useState<string | null>(null);
  const [personalizationBanner, setPersonalizationBanner] = useState(false);
  const [addNameForm, setAddNameForm] = useState({
    name: "", origin: "", meaning: "", phonetic: "", nicknames: "",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNames().then((n) => {
      setAllNames(n);
      setNameMap(new Map(n.map((name) => [name.name, name])));
    });
  }, []);

  const showSnackbar = (msg: string) => {
    setSnackbar(msg);
    setTimeout(() => setSnackbar(null), 3000);
  };

  const selectUser = async (u: string) => {
    setLoading(true);
    // Try localStorage first (instant, always works)
    const local = loadLocal(u);
    if (local) {
      setUser(u);
      setProgress(local);
      setView("rate");
      setLoading(false);
      // Try to sync from server in background (non-blocking)
      fetch(`/api/user?user=${u}`).then(r => r.json()).then(data => {
        if (data && data.lastUpdated > local.lastUpdated) {
          setProgress(data);
          saveLocal(u, data);
        }
      }).catch(() => {});
      return;
    }
    // No local data — try server, then create fresh
    try {
      const res = await fetch(`/api/user?user=${u}`);
      const data = await res.json();
      setUser(u);
      setProgress(data);
      saveLocal(u, data);
      setView("rate");
    } catch {
      const names = await loadNames();
      const shuffled = [...names.map((n) => n.name)].sort(() => Math.random() - 0.5);
      const fresh: UserProgress = {
        currentIndex: 0, nameOrder: shuffled, ratings: {},
        customNames: [], personalizationEnabled: false, lastUpdated: Date.now(),
      };
      setUser(u);
      setProgress(fresh);
      saveLocal(u, fresh);
      setView("rate");
    }
    setLoading(false);
  };

  const saveProgress = useCallback(async (updatedProgress: UserProgress) => {
    if (!user) return;
    setProgress(updatedProgress);
    saveLocal(user, updatedProgress);
    try {
      await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, progress: updatedProgress }),
      });
    } catch { /* offline — localStorage has it */ }
  }, [user]);

  const currentName = progress ? progress.nameOrder[progress.currentIndex] : null;
  const currentNameData = currentName ? nameMap.get(currentName) : null;
  const customNameData = currentName && !currentNameData
    ? progress?.customNames.find((n) => n.name === currentName) : null;

  const rateName = useCallback(async (rating: Rating, direction: "left" | "right" | "up") => {
    if (!progress || !currentName || !user) return;
    setLastRatedName(currentName);
    if (direction === "left") setSwipeClass("swipe-left");
    else if (direction === "right") setSwipeClass("swipe-right");
    else setSwipeClass("swipe-up");

    setTimeout(async () => {
      setSwipeClass("");
      const newRatings = { ...progress.ratings, [currentName]: rating };
      const newIndex = Math.min(progress.currentIndex + 1, progress.nameOrder.length);
      const updated = { ...progress, ratings: newRatings, currentIndex: newIndex, lastUpdated: Date.now() };
      await saveProgress(updated);
      try {
        await fetch("/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user, name: currentName, rating }),
        });
      } catch { /* offline */ }

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
            const userRes = await fetch(`/api/user?user=${user}`);
            const userData = await userRes.json();
            setProgress(userData);
            setTimeout(() => setPersonalizationBanner(false), 5000);
          }
        } catch { /* non-critical */ }
      }
    }, 300);
  }, [progress, currentName, user, saveProgress]);

  const undoLastRating = useCallback(async () => {
    if (!progress || !lastRatedName || !user) return;
    const newRatings = { ...progress.ratings };
    delete newRatings[lastRatedName];
    const newIndex = Math.max(progress.currentIndex - 1, 0);
    const updated = { ...progress, ratings: newRatings, currentIndex: newIndex, lastUpdated: Date.now() };
    await saveProgress(updated);
    setLastRatedName(null);
    try {
      await fetch("/api/ratings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, name: lastRatedName }),
      });
    } catch { /* offline */ }
  }, [progress, lastRatedName, user, saveProgress]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(dx) < 50 && Math.abs(dy) < 50) { touchStart.current = null; return; }
    if (Math.abs(dy) > Math.abs(dx) && dy < -50) rateName("maybe", "up");
    else if (Math.abs(dx) > Math.abs(dy)) {
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
    showSnackbar(`${name} added to favorites`);
    try {
      await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, name, rating: "love" }),
      });
    } catch { /* offline */ }
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
    const loves = Object.entries(progress.ratings).filter(([, r]) => r === "love").map(([n]) => n);
    const maybes = Object.entries(progress.ratings).filter(([, r]) => r === "maybe").map(([n]) => n);
    const text = `Baby Namer - ${user}'s Shortlist\n\nLoves:\n${loves.join("\n")}\n\nMaybes:\n${maybes.join("\n")}`;
    navigator.clipboard.writeText(text);
    showSnackbar("Copied to clipboard");
  };

  const loadCompare = async () => {
    try {
      const res = await fetch("/api/compare");
      const data = await res.json();
      setCompareData(data);
    } catch {
      // Fallback: compare from localStorage
      const nickData = loadLocal("nick");
      const nickiData = loadLocal("nicki");
      if (nickData && nickiData) {
        const bothLoved: string[] = [];
        const oneLovedOneMaybe: string[] = [];
        const bothMaybe: string[] = [];
        const allNames = new Set([...Object.keys(nickData.ratings), ...Object.keys(nickiData.ratings)]);
        allNames.forEach(name => {
          const a = nickData.ratings[name];
          const b = nickiData.ratings[name];
          if (!a || !b) return;
          if (a === "love" && b === "love") bothLoved.push(name);
          else if ((a === "love" && b === "maybe") || (a === "maybe" && b === "love")) oneLovedOneMaybe.push(name);
          else if (a === "maybe" && b === "maybe") bothMaybe.push(name);
        });
        setCompareData({ bothLoved, oneLovedOneMaybe, bothMaybe });
      } else {
        setCompareData({ bothLoved: [], oneLovedOneMaybe: [], bothMaybe: [] });
      }
    }
    setView("compare");
  };

  const submitAddName = async () => {
    if (!user || !addNameForm.name.trim() || !progress) return;
    const newOrder = [...progress.nameOrder];
    newOrder.splice(progress.currentIndex, 0, addNameForm.name.trim());
    const updated: UserProgress = {
      ...progress, nameOrder: newOrder,
      customNames: [...progress.customNames, {
        name: addNameForm.name.trim(), origin: addNameForm.origin || undefined,
        meaning: addNameForm.meaning || undefined, phonetic: addNameForm.phonetic || undefined,
        nicknames: addNameForm.nicknames ? addNameForm.nicknames.split(",").map((n) => n.trim()) : undefined,
      }],
      lastUpdated: Date.now(),
    };
    setProgress(updated);
    saveLocal(user, updated);
    // Try API sync in background
    fetch("/api/names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user, name: addNameForm.name.trim(),
        origin: addNameForm.origin || undefined, meaning: addNameForm.meaning || undefined,
        phonetic: addNameForm.phonetic || undefined,
        nicknames: addNameForm.nicknames ? addNameForm.nicknames.split(",").map((n) => n.trim()) : undefined,
      }),
    }).catch(() => {});
    setAddNameForm({ name: "", origin: "", meaning: "", phonetic: "", nicknames: "" });
    showSnackbar(`${addNameForm.name.trim()} added`);
    setView("rate");
  };

  const totalNames = progress?.nameOrder.length || 0;
  const ratedCount = progress ? Object.keys(progress.ratings).length : 0;
  const loveCount = progress ? Object.values(progress.ratings).filter((r) => r === "love").length : 0;
  const maybeCount = progress ? Object.values(progress.ratings).filter((r) => r === "maybe").length : 0;
  const remaining = totalNames - ratedCount;

  // ===== M3 Top App Bar =====
  const TopBar = ({ title, leading, trailing }: { title: string; leading?: React.ReactNode; trailing?: React.ReactNode }) => (
    <div className="flex items-center h-16 px-1" style={{ background: "var(--md-surface-container-low)" }}>
      <div className="w-12 flex items-center justify-center">{leading}</div>
      <h1 className="flex-1 text-[22px] font-normal" style={{ fontFamily: "var(--font-display)" }}>{title}</h1>
      <div className="flex items-center gap-1">{trailing}</div>
    </div>
  );

  // ===== M3 Icon Button =====
  const IconButton = ({ icon, onClick, label, filled }: { icon: string; onClick: () => void; label?: string; filled?: boolean }) => (
    <button
      onClick={onClick}
      aria-label={label}
      className="state-layer w-12 h-12 flex items-center justify-center rounded-full"
      style={{ color: "var(--md-on-surface-variant)" }}
    >
      <Icon name={icon} filled={filled} />
    </button>
  );

  // ===== M3 Snackbar =====
  const Snackbar = () => snackbar ? (
    <div
      className="fixed bottom-6 left-4 right-4 z-50 flex items-center px-4 py-3 rounded-[4px] elevation-3"
      style={{ background: "var(--md-on-surface)", color: "var(--md-surface)", maxWidth: 400, margin: "0 auto", fontFamily: "var(--font-body)", fontSize: 14 }}
    >
      {snackbar}
    </div>
  ) : null;

  // ===== WELCOME =====
  if (view === "welcome") {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-6" style={{ background: "var(--md-surface)" }}>
        <div className="text-center mb-16">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "var(--md-primary-container)" }}>
            <Icon name="favorite" filled size={36} className="" style={{ color: "var(--md-on-primary-container)" } as React.CSSProperties} />
          </div>
          <h1 className="text-[32px] font-normal mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
            Baby Namer
          </h1>
          <p className="text-sm" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
            Find her perfect name together
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-[280px]">
          <button
            onClick={() => selectUser("nick")}
            disabled={loading}
            className="state-layer w-full h-14 rounded-full text-base font-medium transition-all active:scale-[0.98]"
            style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
          >
            {loading ? "Loading..." : "I'm Nick"}
          </button>
          <button
            onClick={() => selectUser("nicki")}
            disabled={loading}
            className="state-layer w-full h-14 rounded-full text-base font-medium border transition-all active:scale-[0.98]"
            style={{ background: "transparent", color: "var(--md-primary)", borderColor: "var(--md-outline)", fontFamily: "var(--font-display)" }}
          >
            {loading ? "Loading..." : "I'm Nicki"}
          </button>
        </div>
        <Snackbar />
      </div>
    );
  }

  // ===== RATING VIEW =====
  if (view === "rate") {
    const isDone = progress && progress.currentIndex >= progress.nameOrder.length;

    return (
      <div className="flex flex-col min-h-dvh" style={{ background: "var(--md-surface-container-low)" }}>
        {/* Top bar */}
        <TopBar
          title={user === "nick" ? "Nick" : "Nicki"}
          leading={
            <IconButton icon="menu" onClick={() => setMenuOpen(!menuOpen)} />
          }
          trailing={
            <>
              {lastRatedName && (
                <IconButton icon="undo" onClick={undoLastRating} label="Undo" />
              )}
            </>
          }
        />

        {/* Stats chips */}
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium" style={{ background: "var(--md-surface-container)", color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
            <Icon name="check_circle" size={16} />
            {ratedCount}
          </div>
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium" style={{ background: "var(--md-primary-container)", color: "var(--md-on-primary-container)", fontFamily: "var(--font-body)" }}>
            <Icon name="favorite" filled size={16} />
            {loveCount}
          </div>
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium" style={{ background: "var(--md-tertiary-container)", color: "var(--md-on-tertiary-container)", fontFamily: "var(--font-body)" }}>
            <Icon name="help" size={16} />
            {maybeCount}
          </div>
          <span className="ml-auto text-xs" style={{ color: "var(--md-on-surface-variant)" }}>{remaining} left</span>
        </div>

        {/* Progress */}
        <div className="px-4 mb-3">
          <div className="progress-track">
            <div className="progress-indicator" style={{ width: `${totalNames > 0 ? (ratedCount / totalNames) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Personalization banner */}
        {personalizationBanner && (
          <div className="mx-4 mb-3 flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "var(--md-primary-container)", color: "var(--md-on-primary-container)" }}>
            <Icon name="auto_awesome" size={20} />
            <span className="text-sm" style={{ fontFamily: "var(--font-body)" }}>Names personalized based on your taste</span>
          </div>
        )}

        {/* Menu */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setMenuOpen(false)} />
            <div className="fixed top-0 left-0 bottom-0 w-[280px] z-50 elevation-3 flex flex-col" style={{ background: "var(--md-surface-container-low)" }}>
              <div className="h-16 flex items-center px-4">
                <h2 className="text-base font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface-variant)" }}>Baby Namer</h2>
              </div>
              <div className="px-3">
                <button onClick={() => { setMenuOpen(false); setView("shortlist"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-sm font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="favorite" size={24} /> My Shortlist
                </button>
                <button onClick={() => { setMenuOpen(false); loadCompare(); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-sm font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="compare" size={24} /> Compare
                </button>
                <button onClick={() => { setMenuOpen(false); setView("addName"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-sm font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="add_circle" size={24} /> Add a Name
                </button>
                <div className="my-2 mx-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />
                <button onClick={() => { setMenuOpen(false); setUser(null); setProgress(null); setView("welcome"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-sm font-medium" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                  <Icon name="swap_horiz" size={24} /> Switch User
                </button>
              </div>
            </div>
          </>
        )}

        {/* Card area */}
        <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
          {isDone ? (
            <div className="text-center px-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "var(--md-primary-container)" }}>
                <Icon name="celebration" filled size={32} className="" style={{ color: "var(--md-on-primary-container)" } as React.CSSProperties} />
              </div>
              <h2 className="text-2xl font-normal mb-2" style={{ fontFamily: "var(--font-display)" }}>All done!</h2>
              <p className="text-sm mb-8" style={{ color: "var(--md-on-surface-variant)" }}>
                You&apos;ve rated all {totalNames} names
              </p>
              <div className="flex flex-col gap-3 w-full max-w-[260px] mx-auto">
                <button onClick={() => setView("shortlist")} className="state-layer h-12 rounded-full text-sm font-medium" style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}>
                  View Shortlist
                </button>
                <button onClick={loadCompare} className="state-layer h-12 rounded-full text-sm font-medium border" style={{ color: "var(--md-primary)", borderColor: "var(--md-outline)", fontFamily: "var(--font-display)" }}>
                  Compare with Partner
                </button>
              </div>
            </div>
          ) : currentName ? (
            <div
              ref={cardRef}
              className={`w-full max-w-sm rounded-3xl overflow-hidden ${swipeClass || "card-enter"}`}
              style={{ background: "var(--md-surface-container-lowest)", boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05)" }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Header section */}
              <div className="px-6 pt-6 pb-4 text-center" style={{ background: "var(--md-surface-container-lowest)" }}>
                <h2 className="text-[36px] font-medium mb-1" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.5px" }}>
                  {renderNameWithHighlight(currentName, "card")}
                </h2>
                <p className="text-base mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface-variant)" }}>
                  {renderNameWithHighlight(currentName, "fullname")}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm italic" style={{ color: "var(--md-outline)" }}>
                    {currentNameData?.phonetic || customNameData?.phonetic || ""}
                  </span>
                  <button
                    onClick={() => speak(currentName)}
                    className="state-layer w-9 h-9 flex items-center justify-center rounded-full"
                    style={{ color: "var(--md-on-surface-variant)" }}
                  >
                    <Icon name="volume_up" size={20} />
                  </button>
                </div>
              </div>

              {/* Info rows */}
              <div className="px-6 pb-3">
                <div className="flex items-start gap-3 py-3 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                  <Icon name="public" size={20} className="" style={{ color: "var(--md-on-surface-variant)", marginTop: 1 } as React.CSSProperties} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Origin</div>
                    <div className="text-sm font-medium" style={{ color: "var(--md-on-surface)" }}>
                      {currentNameData?.origin || customNameData?.origin || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Syllables</div>
                    <div className="text-sm font-medium" style={{ color: "var(--md-on-surface)" }}>
                      {currentNameData?.syllables || "—"}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 py-3 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                  <Icon name="lightbulb" size={20} className="" style={{ color: "var(--md-on-surface-variant)", marginTop: 1 } as React.CSSProperties} />
                  <div className="flex-1">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Meaning</div>
                    <div className="text-sm font-medium leading-snug" style={{ color: "var(--md-on-surface)" }}>
                      {currentNameData?.meaning || customNameData?.meaning || "—"}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 py-3 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                  <Icon name="badge" size={20} className="" style={{ color: "var(--md-on-surface-variant)", marginTop: 1 } as React.CSSProperties} />
                  <div className="flex-1">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Nicknames</div>
                    <div className="text-sm font-medium" style={{ color: "var(--md-on-surface)" }}>
                      {(currentNameData?.nicknames || customNameData?.nicknames || []).join(", ") || "None"}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 py-3 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                  <Icon name="trending_up" size={20} className="" style={{ color: "var(--md-on-surface-variant)", marginTop: 1 } as React.CSSProperties} />
                  <div className="flex-1">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Peak</div>
                    <div className="text-sm font-medium" style={{ color: "var(--md-on-surface)" }}>
                      {currentNameData?.peakDecades?.join(", ") || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs mb-0.5" style={{ color: "var(--md-on-surface-variant)" }}>Top state</div>
                    <div className="text-sm font-medium" style={{ color: "var(--md-on-surface)" }}>
                      {currentNameData?.popularState || "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Similar names — always visible as M3 assist chips */}
              {currentNameData?.similarNames && currentNameData.similarNames.length > 0 && (
                <div className="px-6 pb-5 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                  <div className="text-xs pt-3 pb-2" style={{ color: "var(--md-on-surface-variant)" }}>Similar names</div>
                  <div className="flex flex-wrap gap-2">
                    {currentNameData.similarNames.map((sn) => (
                      <button
                        key={sn}
                        onClick={() => addToFavorites(sn)}
                        className="state-layer inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-sm"
                        style={{ borderColor: "var(--md-outline)", color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}
                      >
                        {sn}
                        <Icon name="favorite" size={16} className="" style={{ color: "var(--md-primary)" } as React.CSSProperties} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--md-on-surface-variant)" }} className="text-sm">Loading...</div>
          )}
        </div>

        {/* Rating FABs */}
        {!isDone && currentName && (
          <div className="flex items-center justify-center gap-4 py-5">
            <button
              onClick={() => rateName("pass", "left")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-2xl elevation-2 transition-transform active:scale-95"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              <Icon name="close" size={28} />
            </button>
            <button
              onClick={() => rateName("maybe", "up")}
              className="state-layer w-12 h-12 flex items-center justify-center rounded-xl elevation-1 transition-transform active:scale-95"
              style={{ background: "var(--md-tertiary-container)", color: "var(--md-on-tertiary-container)" }}
            >
              <Icon name="help" size={24} />
            </button>
            <button
              onClick={() => rateName("love", "right")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-2xl transition-transform active:scale-95"
              style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 4px 8px rgba(180,36,90,0.25)" }}
            >
              <Icon name="favorite" filled size={28} />
            </button>
          </div>
        )}

        {/* Swipe hint */}
        {ratedCount === 0 && currentName && !isDone && (
          <p className="text-center text-xs pb-4 -mt-2" style={{ color: "var(--md-outline)" }}>
            Swipe right to love, left to pass, up for maybe
          </p>
        )}

        <Snackbar />
      </div>
    );
  }

  // ===== SHORTLIST =====
  if (view === "shortlist") {
    const loves = progress ? Object.entries(progress.ratings).filter(([, r]) => r === "love").map(([n]) => n) : [];
    const maybes = progress ? Object.entries(progress.ratings).filter(([, r]) => r === "maybe").map(([n]) => n) : [];

    const NameListItem = ({ name, accent }: { name: string; accent?: string }) => {
      const data = nameMap.get(name);
      return (
        <div className="flex items-center gap-4 px-4 py-3 state-layer" style={{ background: "var(--md-surface-container-lowest)" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium" style={{ background: accent || "var(--md-primary-container)", color: accent ? "var(--md-on-tertiary-container)" : "var(--md-on-primary-container)", fontFamily: "var(--font-display)" }}>
            {name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium" style={{ fontFamily: "var(--font-display)" }}>
              {renderNameWithHighlight(name, "card")}
            </div>
            {data && (
              <div className="text-xs truncate" style={{ color: "var(--md-on-surface-variant)" }}>
                {data.origin} &middot; {data.meaning}
              </div>
            )}
          </div>
          <button onClick={() => removeFromShortlist(name)} className="state-layer w-10 h-10 flex items-center justify-center rounded-full" style={{ color: "var(--md-on-surface-variant)" }}>
            <Icon name="close" size={20} />
          </button>
        </div>
      );
    };

    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--md-surface-container-low)" }}>
        <TopBar
          title="Shortlist"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={<IconButton icon="content_copy" onClick={exportShortlist} label="Copy" />}
        />
        <div className="flex-1 overflow-y-auto">
          {loves.length > 0 && (
            <div className="mb-2">
              <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--md-primary)", fontFamily: "var(--font-body)" }}>
                Loved ({loves.length})
              </div>
              <div className="mx-4 rounded-xl overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
                {loves.map((name, i) => (
                  <div key={name}>
                    {i > 0 && <div className="ml-[72px] border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
                    <NameListItem name={name} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {maybes.length > 0 && (
            <div className="mb-2">
              <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--md-tertiary)", fontFamily: "var(--font-body)" }}>
                Maybe ({maybes.length})
              </div>
              <div className="mx-4 rounded-xl overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
                {maybes.map((name, i) => (
                  <div key={name}>
                    {i > 0 && <div className="ml-[72px] border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
                    <NameListItem name={name} accent="var(--md-tertiary-container)" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {loves.length === 0 && maybes.length === 0 && (
            <div className="text-center mt-24 px-8">
              <Icon name="favorite" size={48} className="" style={{ color: "var(--md-outline-variant)" } as React.CSSProperties} />
              <p className="mt-4 text-sm" style={{ color: "var(--md-on-surface-variant)" }}>Your shortlist is empty</p>
              <p className="text-xs mt-1" style={{ color: "var(--md-outline)" }}>Names you love or maybe will appear here</p>
            </div>
          )}
          <div className="h-8" />
        </div>
        <Snackbar />
      </div>
    );
  }

  // ===== COMPARE =====
  if (view === "compare") {
    const CompareCard = ({ name, border }: { name: string; border: string }) => {
      const data = nameMap.get(name);
      return (
        <div className="flex items-center gap-4 px-4 py-3" style={{ borderLeft: `3px solid ${border}` }}>
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium" style={{ fontFamily: "var(--font-display)" }}>
              {renderNameWithHighlight(name, "card")}
              <span className="ml-2 text-sm font-normal" style={{ color: "var(--md-on-surface-variant)" }}>
                {renderNameWithHighlight(name, "fullname")}
              </span>
            </div>
            {data && (
              <div className="text-xs mt-1" style={{ color: "var(--md-on-surface-variant)" }}>
                {data.origin} &middot; {data.meaning} &middot; {data.phonetic}
              </div>
            )}
          </div>
        </div>
      );
    };

    const Section = ({ title, icon, names, color, border }: { title: string; icon: string; names: string[]; color: string; border: string }) => names.length === 0 ? null : (
      <div className="mb-4">
        <div className="flex items-center gap-2 px-4 py-3">
          <Icon name={icon} filled size={20} className="" style={{ color } as React.CSSProperties} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color, fontFamily: "var(--font-body)" }}>
            {title} ({names.length})
          </span>
        </div>
        <div className="mx-4 rounded-xl overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
          {names.map((name, i) => (
            <div key={name}>
              {i > 0 && <div className="ml-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
              <CompareCard name={name} border={border} />
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--md-surface-container-low)" }}>
        <TopBar
          title="Compare"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={null}
        />
        <div className="flex-1 overflow-y-auto">
          {!compareData ? (
            <div className="text-center mt-24" style={{ color: "var(--md-on-surface-variant)" }}>Loading...</div>
          ) : (
            <>
              <Section title="Both loved" icon="favorite" names={compareData.bothLoved} color="var(--md-primary)" border="var(--md-primary)" />
              <Section title="One love, one maybe" icon="thumbs_up_down" names={compareData.oneLovedOneMaybe} color="var(--md-tertiary)" border="var(--md-tertiary)" />
              <Section title="Both maybe" icon="help" names={compareData.bothMaybe} color="var(--md-outline)" border="var(--md-outline)" />
              {compareData.bothLoved.length === 0 && compareData.oneLovedOneMaybe.length === 0 && compareData.bothMaybe.length === 0 && (
                <div className="text-center mt-24 px-8">
                  <Icon name="compare" size={48} className="" style={{ color: "var(--md-outline-variant)" } as React.CSSProperties} />
                  <p className="mt-4 text-sm" style={{ color: "var(--md-on-surface-variant)" }}>No matches yet</p>
                  <p className="text-xs mt-1" style={{ color: "var(--md-outline)" }}>Both partners need to rate names first</p>
                </div>
              )}
            </>
          )}
          <div className="h-8" />
        </div>
        <Snackbar />
      </div>
    );
  }

  // ===== ADD NAME =====
  if (view === "addName") {
    const TextField = ({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; required?: boolean }) => (
      <div className="relative">
        <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
          {label}{required && " *"}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-14 px-4 rounded-xl border text-sm focus:outline-none transition-colors"
          style={{
            background: "var(--md-surface-container-lowest)",
            borderColor: value ? "var(--md-primary)" : "var(--md-outline-variant)",
            color: "var(--md-on-surface)",
            fontFamily: "var(--font-body)",
          }}
          onFocus={(e) => { e.target.style.borderColor = "var(--md-primary)"; e.target.style.borderWidth = "2px"; }}
          onBlur={(e) => { e.target.style.borderColor = value ? "var(--md-primary)" : "var(--md-outline-variant)"; e.target.style.borderWidth = "1px"; }}
        />
      </div>
    );

    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--md-surface-container-low)" }}>
        <TopBar
          title="Add a name"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={null}
        />
        <div className="flex-1 overflow-y-auto px-4 pt-2">
          <div className="rounded-xl p-5 space-y-5" style={{ background: "var(--md-surface-container-lowest)" }}>
            <TextField label="Name" value={addNameForm.name} onChange={(v) => setAddNameForm({ ...addNameForm, name: v })} placeholder="e.g. Mila" required />
            <TextField label="Origin" value={addNameForm.origin} onChange={(v) => setAddNameForm({ ...addNameForm, origin: v })} placeholder="e.g. Ukrainian" />
            <TextField label="Meaning" value={addNameForm.meaning} onChange={(v) => setAddNameForm({ ...addNameForm, meaning: v })} placeholder="e.g. Gracious, dear" />
            <TextField label="Phonetic" value={addNameForm.phonetic} onChange={(v) => setAddNameForm({ ...addNameForm, phonetic: v })} placeholder="e.g. MEE-lah" />
            <TextField label="Nicknames" value={addNameForm.nicknames} onChange={(v) => setAddNameForm({ ...addNameForm, nicknames: v })} placeholder="e.g. Mi, Mimi" />
            <button
              onClick={submitAddName}
              disabled={!addNameForm.name.trim()}
              className="state-layer w-full h-12 rounded-full text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
            >
              Add name
            </button>
          </div>
        </div>
        <Snackbar />
      </div>
    );
  }

  return null;
}
