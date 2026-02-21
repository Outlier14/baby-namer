"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BabyName } from "@/lib/names";
import type { MiddleName } from "@/lib/names";
import type { UserProgress, Rating } from "@/lib/redis";

type View = "welcome" | "rate" | "shortlist" | "compare" | "addName" | "pickFirstNames" | "rateMiddle" | "pairings";

let allNamesCache: BabyName[] | null = null;
let middleNamesCache: MiddleName[] | null = null;
async function loadNames(): Promise<BabyName[]> {
  if (allNamesCache) return allNamesCache;
  const mod = await import("@/lib/names");
  allNamesCache = mod.default;
  middleNamesCache = mod.middleNames;
  return allNamesCache;
}
async function loadMiddleNames(): Promise<MiddleName[]> {
  if (middleNamesCache) return middleNamesCache;
  const mod = await import("@/lib/names");
  middleNamesCache = mod.middleNames;
  return middleNamesCache;
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

function speak(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
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
function getTutorialSeen(user: string): boolean {
  try { return localStorage.getItem(`babynamer_tutorial_${user}`) === "true"; } catch { return false; }
}
function setTutorialSeen(user: string) {
  try { localStorage.setItem(`babynamer_tutorial_${user}`, "true"); } catch { /* */ }
}

// ===== TUTORIAL COMPONENT =====
function Tutorial({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: "swipe",
      title: "Swipe to rate",
      desc: "Swipe right to love a name, left to pass, or up for maybe. You can also use the buttons below the card.",
    },
    {
      icon: "favorite",
      title: "Three choices",
      desc: "Love it — add to your shortlist. Maybe — keep it as a backup. Pass — move on to the next name.",
    },
    {
      icon: "bar_chart",
      title: "Track progress",
      desc: "Watch your stats and progress bar as you go. See how many you've loved, maybe'd, and how many are left.",
    },
    {
      icon: "compare",
      title: "Compare together",
      desc: "Open the menu to see your shortlist or compare picks with your partner. Find names you both love!",
    },
  ];
  const s = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        className="w-[320px] rounded-[28px] p-8 text-center tutorial-enter"
        style={{ background: "var(--md-surface-container-highest)" }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: "var(--md-primary-container)" }}
        >
          <Icon name={s.icon} filled size={32} style={{ color: "var(--md-on-primary-container)" }} />
        </div>
        <h3 className="text-[22px] font-medium mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
          {s.title}
        </h3>
        <p className="text-[14px] leading-[20px] mb-8" style={{ fontFamily: "var(--font-body)", color: "var(--md-on-surface-variant)" }}>
          {s.desc}
        </p>
        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                background: i === step ? "var(--md-primary)" : "var(--md-outline-variant)",
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={onComplete}
            className="h-10 px-3 rounded-full text-[14px] font-medium"
            style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}
          >
            Skip
          </button>
          <button
            onClick={() => isLast ? onComplete() : setStep(step + 1)}
            className="state-layer h-10 px-6 rounded-full text-[14px] font-medium"
            style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
          >
            {isLast ? "Got it!" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("welcome");
  const [user, setUser] = useState<string | null>(null);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [, setAllNames] = useState<BabyName[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, BabyName>>(new Map());
  const [middleNameList, setMiddleNameList] = useState<MiddleName[]>([]);
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
  const [showTutorial, setShowTutorial] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  // Middle name picking
  const [selectedFirstNames, setSelectedFirstNames] = useState<Set<string>>(new Set());

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragHint, setDragHint] = useState<"love" | "pass" | "maybe" | null>(null);

  useEffect(() => {
    loadNames().then((n) => {
      setAllNames(n);
      setNameMap(new Map(n.map((name) => [name.name, name])));
    });
    loadMiddleNames().then((m) => setMiddleNameList(m));
  }, []);

  const showSnackbar = (msg: string) => {
    setSnackbar(msg);
    setTimeout(() => setSnackbar(null), 3000);
  };

  const selectUser = async (u: string) => {
    setLoading(true);
    const local = loadLocal(u);
    if (local) {
      setUser(u);
      setProgress(local);
      // Check tutorial
      if (!getTutorialSeen(u)) {
        setShowTutorial(true);
      }
      setView("rate");
      setLoading(false);
      fetch(`/api/user?user=${u}`).then(r => r.json()).then(data => {
        if (data && data.lastUpdated > local.lastUpdated) {
          setProgress(data);
          saveLocal(u, data);
        }
      }).catch(() => {});
      return;
    }
    try {
      const res = await fetch(`/api/user?user=${u}`);
      const data = await res.json();
      setUser(u);
      setProgress(data);
      saveLocal(u, data);
      if (!getTutorialSeen(u)) setShowTutorial(true);
      setView("rate");
    } catch {
      const names = await loadNames();
      const shuffled = [...names.map((n) => n.name)].sort(() => Math.random() - 0.5);
      const fresh: UserProgress = {
        currentIndex: 0, nameOrder: shuffled, ratings: {},
        customNames: [], personalizationEnabled: false, lastUpdated: Date.now(),
        hasSeenTutorial: false, phase: "first",
      };
      setUser(u);
      setProgress(fresh);
      saveLocal(u, fresh);
      if (!getTutorialSeen(u)) setShowTutorial(true);
      setView("rate");
    }
    setLoading(false);
  };

  const completeTutorial = () => {
    setShowTutorial(false);
    if (user) setTutorialSeen(user);
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
    } catch { /* offline */ }
  }, [user]);

  const currentName = progress ? progress.nameOrder[progress.currentIndex] : null;
  const currentNameData = currentName ? nameMap.get(currentName) : null;
  const customNameData = currentName && !currentNameData
    ? progress?.customNames.find((n) => n.name === currentName) : null;

  const rateName = useCallback(async (rating: Rating, direction: "left" | "right" | "up") => {
    if (!progress || !currentName || !user) return;
    setLastRatedName(currentName);
    setSimilarOpen(false);
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

  // Middle name rating
  const rateMiddleName = useCallback(async (middleName: string, rating: Rating, direction: "left" | "right" | "up") => {
    if (!progress || !user || !progress.activeFirstName) return;
    const firstName = progress.activeFirstName;

    if (direction === "left") setSwipeClass("swipe-left");
    else if (direction === "right") setSwipeClass("swipe-right");
    else setSwipeClass("swipe-up");

    setTimeout(async () => {
      setSwipeClass("");
      const currentMiddleRatings = progress.middleNameRatings || {};
      const firstNameRatings = currentMiddleRatings[firstName] || {};
      const updatedFirstNameRatings = { ...firstNameRatings, [middleName]: rating };
      const updatedMiddleRatings = { ...currentMiddleRatings, [firstName]: updatedFirstNameRatings };
      const newIndex = (progress.middleNameIndex || 0) + 1;
      const updated = {
        ...progress,
        middleNameRatings: updatedMiddleRatings,
        middleNameIndex: newIndex,
        lastUpdated: Date.now(),
      };
      await saveProgress(updated);
    }, 300);
  }, [progress, user, saveProgress]);

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

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current || !cardRef.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;

    // Determine dominant axis
    const isHorizontal = Math.abs(dx) >= Math.abs(dy);
    const isUpSwipe = !isHorizontal && dy < 0;

    // Apply real-time transform
    let translateX = 0;
    let translateY = 0;
    let rotate = 0;
    let opacity = 1;

    if (isHorizontal) {
      translateX = dx;
      rotate = dx * 0.04; // subtle tilt
      opacity = Math.max(0.5, 1 - Math.abs(dx) / 300);
    } else if (isUpSwipe) {
      translateY = dy;
      opacity = Math.max(0.5, 1 - Math.abs(dy) / 300);
    }

    cardRef.current.style.transform = `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotate}deg)`;
    cardRef.current.style.opacity = String(opacity);
    cardRef.current.classList.add("card-dragging");

    // Update hint overlay
    const threshold = 30;
    if (Math.abs(dx) > threshold && isHorizontal) {
      setDragHint(dx > 0 ? "love" : "pass");
    } else if (isUpSwipe && Math.abs(dy) > threshold) {
      setDragHint("maybe");
    } else {
      setDragHint(null);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;

    // Reset card transform
    if (cardRef.current) {
      cardRef.current.style.transform = "";
      cardRef.current.style.opacity = "";
      cardRef.current.classList.remove("card-dragging");
    }
    setDragHint(null);

    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(dx) < 50 && Math.abs(dy) < 50) { touchStart.current = null; return; }
    if (view === "rateMiddle") {
      const middleOrder = progress?.middleNameOrder || [];
      const middleIdx = progress?.middleNameIndex || 0;
      const currentMiddle = middleOrder[middleIdx];
      if (!currentMiddle) { touchStart.current = null; return; }
      if (Math.abs(dy) > Math.abs(dx) && dy < -50) rateMiddleName(currentMiddle, "maybe", "up");
      else if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 50) rateMiddleName(currentMiddle, "love", "right");
        else if (dx < -50) rateMiddleName(currentMiddle, "pass", "left");
      }
    } else {
      if (Math.abs(dy) > Math.abs(dx) && dy < -50) rateName("maybe", "up");
      else if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 50) rateName("love", "right");
        else if (dx < -50) rateName("pass", "left");
      }
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

  // Start middle name phase
  const startMiddleNamePhase = async () => {
    if (!progress || !user) return;
    const selected = Array.from(selectedFirstNames);
    if (selected.length === 0) return;
    const shuffledMiddles = [...middleNameList.map(m => m.name)].sort(() => Math.random() - 0.5);
    const updated: UserProgress = {
      ...progress,
      phase: "middle",
      topFirstNames: selected,
      middleNameOrder: shuffledMiddles,
      middleNameIndex: 0,
      middleNameRatings: {},
      activeFirstName: selected[0],
      lastUpdated: Date.now(),
    };
    await saveProgress(updated);
    setView("rateMiddle");
  };

  // Switch active first name for middle name rating
  const switchActiveFirstName = async (firstName: string) => {
    if (!progress || !user) return;
    const updated = {
      ...progress,
      activeFirstName: firstName,
      middleNameIndex: 0,
      lastUpdated: Date.now(),
    };
    await saveProgress(updated);
  };

  const totalNames = progress?.nameOrder.length || 0;
  const ratedCount = progress ? Object.keys(progress.ratings).length : 0;
  const loveCount = progress ? Object.values(progress.ratings).filter((r) => r === "love").length : 0;
  const maybeCount = progress ? Object.values(progress.ratings).filter((r) => r === "maybe").length : 0;
  const remaining = totalNames - ratedCount;

  // ===== M3 Top App Bar ===== (M3 spec: 64px height, 16px horizontal padding)
  const TopBar = ({ title, leading, trailing }: { title: string; leading?: React.ReactNode; trailing?: React.ReactNode }) => (
    <div
      className="flex items-center h-16 px-4 shrink-0"
      style={{ background: "var(--md-surface-container-low)", borderBottom: "1px solid var(--md-outline-variant)" }}
    >
      <div className="w-12 h-12 flex items-center justify-center shrink-0">{leading}</div>
      <h1 className="flex-1 text-[22px] font-normal ml-1 truncate" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>{title}</h1>
      <div className="flex items-center shrink-0">{trailing}</div>
    </div>
  );

  // ===== M3 Icon Button ===== (M3 spec: 48px touch target, 40px visible, centered icon)
  const IconButton = ({ icon, onClick, label, filled }: { icon: string; onClick: () => void; label?: string; filled?: boolean }) => (
    <button
      onClick={onClick}
      aria-label={label}
      className="state-layer w-12 h-12 flex items-center justify-center rounded-full"
      style={{ color: "var(--md-on-surface-variant)" }}
    >
      <Icon name={icon} filled={filled} size={24} />
    </button>
  );

  // ===== M3 Snackbar =====
  const Snackbar = () => snackbar ? (
    <div
      className="fixed bottom-6 left-4 right-4 z-50 flex items-center px-4 py-3 rounded-[4px] elevation-3"
      style={{ background: "var(--md-on-surface)", color: "var(--md-surface)", maxWidth: 400, margin: "0 auto", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px" }}
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
            <Icon name="favorite" filled size={36} style={{ color: "var(--md-on-primary-container)" }} />
          </div>
          <h1 className="text-[32px] font-normal mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
            Baby Namer
          </h1>
          <p className="text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
            Find her perfect name together
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-[312px]">
          <button
            onClick={() => selectUser("nick")}
            disabled={loading}
            className="state-layer w-full h-[56px] rounded-full text-[14px] font-medium tracking-[0.1px] transition-all active:scale-[0.98]"
            style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
          >
            {loading ? "Loading..." : "I'm Nick"}
          </button>
          <button
            onClick={() => selectUser("nicki")}
            disabled={loading}
            className="state-layer w-full h-[56px] rounded-full text-[14px] font-medium tracking-[0.1px] border transition-all active:scale-[0.98]"
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
      <div className="flex flex-col min-h-dvh mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        {showTutorial && <Tutorial onComplete={completeTutorial} />}

        {/* Top bar */}
        <TopBar
          title={user === "nick" ? "Nick" : "Nicki"}
          leading={<IconButton icon="menu" onClick={() => setMenuOpen(!menuOpen)} />}
          trailing={lastRatedName ? <IconButton icon="undo" onClick={undoLastRating} label="Undo" /> : undefined}
        />

        {/* Stats chips — M3 spec: 32px chip height, 8px gap, 16px horizontal padding */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium leading-[16px]" style={{ background: "var(--md-surface-container)", color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
            <Icon name="check_circle" size={16} />
            <span>{ratedCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium leading-[16px]" style={{ background: "var(--md-primary-container)", color: "var(--md-on-primary-container)", fontFamily: "var(--font-body)" }}>
            <Icon name="favorite" filled size={16} />
            <span>{loveCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium leading-[16px]" style={{ background: "var(--md-tertiary-container)", color: "var(--md-on-tertiary-container)", fontFamily: "var(--font-body)" }}>
            <Icon name="help" size={16} />
            <span>{maybeCount}</span>
          </div>
          <span className="ml-auto text-[12px] leading-[16px] font-medium" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>{remaining} left</span>
        </div>

        {/* Progress — M3 spec: 4px track height */}
        <div className="px-4 mb-4">
          <div className="progress-track">
            <div className="progress-indicator" style={{ width: `${totalNames > 0 ? (ratedCount / totalNames) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Personalization banner */}
        {personalizationBanner && (
          <div className="mx-4 mb-4 flex items-center gap-4 px-4 py-3 rounded-[12px]" style={{ background: "var(--md-primary-container)", color: "var(--md-on-primary-container)" }}>
            <Icon name="auto_awesome" size={20} />
            <span className="text-[14px] leading-[20px]" style={{ fontFamily: "var(--font-body)" }}>Names personalized based on your taste</span>
          </div>
        )}

        {/* Navigation Menu — M3 spec: 360px max width, 256px min, 56px item height */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setMenuOpen(false)} />
            <div className="fixed top-0 left-0 bottom-0 w-[280px] z-50 elevation-3 flex flex-col" style={{ background: "var(--md-surface-container-low)" }}>
              <div className="h-16 flex items-center px-7">
                <h2 className="text-[14px] font-medium tracking-[0.1px]" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface-variant)" }}>Baby Namer</h2>
              </div>
              <div className="px-3">
                <button onClick={() => { setMenuOpen(false); setView("shortlist"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-[14px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="favorite" size={24} /> My Shortlist
                </button>
                <button onClick={() => { setMenuOpen(false); loadCompare(); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-[14px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="compare" size={24} /> Compare
                </button>
                <button onClick={() => { setMenuOpen(false); setView("addName"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-[14px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                  <Icon name="add_circle" size={24} /> Add a Name
                </button>
                {/* Middle name option — only if user has some loved names */}
                {loveCount >= 2 && (
                  <button onClick={() => { setMenuOpen(false); setView("pickFirstNames"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-[14px] font-medium" style={{ color: "var(--md-primary)", fontFamily: "var(--font-body)" }}>
                    <Icon name="child_care" size={24} /> Pick Middle Names
                  </button>
                )}
                <div className="my-2 mx-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />
                <button onClick={() => { setMenuOpen(false); setUser(null); setProgress(null); setView("welcome"); }} className="state-layer w-full flex items-center gap-3 h-14 px-4 rounded-full text-[14px] font-medium" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
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
                <Icon name="celebration" filled size={32} style={{ color: "var(--md-on-primary-container)" }} />
              </div>
              <h2 className="text-[24px] font-normal mb-2" style={{ fontFamily: "var(--font-display)" }}>All done!</h2>
              <p className="text-[14px] leading-[20px] mb-8" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                You&apos;ve rated all {totalNames} names
              </p>
              <div className="flex flex-col gap-3 w-full max-w-[280px] mx-auto">
                <button onClick={() => setView("shortlist")} className="state-layer h-[40px] rounded-full text-[14px] font-medium tracking-[0.1px]" style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}>
                  View Shortlist
                </button>
                <button onClick={loadCompare} className="state-layer h-[40px] rounded-full text-[14px] font-medium tracking-[0.1px] border" style={{ color: "var(--md-primary)", borderColor: "var(--md-outline)", fontFamily: "var(--font-display)" }}>
                  Compare with Partner
                </button>
                {loveCount >= 2 && (
                  <button onClick={() => setView("pickFirstNames")} className="state-layer h-[40px] rounded-full text-[14px] font-medium tracking-[0.1px] border" style={{ color: "var(--md-primary)", borderColor: "var(--md-primary)", fontFamily: "var(--font-display)" }}>
                    Pick Middle Names
                  </button>
                )}
              </div>
            </div>
          ) : currentName ? (
            <div
              ref={cardRef}
              className={`w-full rounded-[28px] overflow-hidden ${swipeClass || "card-enter"}`}
              style={{ background: "var(--md-surface-container-lowest)", boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05)", position: "relative" }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Drag hint overlay */}
              {dragHint === "love" && <div className="swipe-hint-love" />}
              {dragHint === "pass" && <div className="swipe-hint-pass" />}
              {dragHint === "maybe" && <div className="swipe-hint-maybe" />}

              {/* Header — centered, iOS-style */}
              <div className="px-6 pt-8 pb-4 text-center">
                <h2 className="text-[36px] font-semibold mb-1" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.5px", color: "var(--md-on-surface)" }}>
                  {renderNameWithHighlight(currentName, "card")}
                </h2>
                <p className="text-[16px] leading-[22px] mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface-variant)", fontWeight: 400 }}>
                  {renderNameWithHighlight(currentName, "fullname")}
                </p>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-[14px] italic leading-[20px]" style={{ color: "var(--md-outline)" }}>
                    {currentNameData?.phonetic || customNameData?.phonetic || ""}
                  </span>
                  <button
                    onClick={() => speak(currentName)}
                    className="state-layer w-9 h-9 flex items-center justify-center rounded-full"
                    style={{ color: "var(--md-on-surface-variant)" }}
                  >
                    <Icon name="volume_up" size={18} />
                  </button>
                </div>
              </div>

              {/* Stats row — 3-column centered pill badges */}
              <div className="px-6 pb-4">
                <div className="flex items-stretch justify-center gap-2">
                  <div className="flex-1 flex flex-col items-center justify-center py-3 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                    <span className="text-[10px] font-medium tracking-[0.8px] uppercase mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Origin</span>
                    <span className="text-[13px] font-semibold text-center leading-[18px]" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-display)" }}>
                      {currentNameData?.origin || customNameData?.origin || "—"}
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center py-3 px-4 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                    <span className="text-[10px] font-medium tracking-[0.8px] uppercase mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Syllables</span>
                    <span className="text-[20px] font-semibold" style={{ color: "var(--md-primary)", fontFamily: "var(--font-display)" }}>
                      {currentNameData?.syllables || "—"}
                    </span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center py-3 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                    <span className="text-[10px] font-medium tracking-[0.8px] uppercase mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Top state</span>
                    <span className="text-[13px] font-semibold text-center leading-[18px]" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-display)" }}>
                      {currentNameData?.popularState || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meaning — centered, full-width */}
              <div className="px-6 pb-3">
                <div className="text-center px-2 py-3 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                  <span className="text-[10px] font-medium tracking-[0.8px] uppercase block mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Meaning</span>
                  <span className="text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                    {currentNameData?.meaning || customNameData?.meaning || "—"}
                  </span>
                </div>
              </div>

              {/* Nicknames + Peak — two-column centered */}
              <div className="px-6 pb-4">
                <div className="flex gap-2">
                  <div className="flex-1 text-center py-3 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                    <span className="text-[10px] font-medium tracking-[0.8px] uppercase block mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Nicknames</span>
                    <span className="text-[13px] leading-[18px]" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                      {(currentNameData?.nicknames || customNameData?.nicknames || []).join(", ") || "None"}
                    </span>
                  </div>
                  <div className="flex-1 text-center py-3 rounded-[16px]" style={{ background: "var(--md-surface-container)" }}>
                    <span className="text-[10px] font-medium tracking-[0.8px] uppercase block mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Peak era</span>
                    <span className="text-[13px] leading-[18px]" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>
                      {currentNameData?.peakDecades?.join(", ") || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Similar names — collapsible dropdown */}
              {currentNameData?.similarNames && currentNameData.similarNames.length > 0 && (
                <div className="px-6 pb-4">
                  <button
                    onClick={() => setSimilarOpen(!similarOpen)}
                    className="state-layer w-full flex items-center justify-between py-3 px-1 rounded-lg"
                    style={{ color: "var(--md-on-surface-variant)" }}
                  >
                    <span className="text-[12px] leading-[16px] font-medium" style={{ fontFamily: "var(--font-body)" }}>
                      Similar names ({currentNameData.similarNames.length})
                    </span>
                    <Icon name={similarOpen ? "expand_less" : "expand_more"} size={20} />
                  </button>
                  {similarOpen && (
                    <div className="flex flex-wrap gap-2 pt-1 pb-2">
                      {currentNameData.similarNames.map((sn) => (
                        <button
                          key={sn}
                          onClick={() => addToFavorites(sn)}
                          className="state-layer inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] leading-[18px]"
                          style={{ borderColor: "var(--md-outline-variant)", color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}
                        >
                          {sn}
                          <Icon name="favorite" size={14} style={{ color: "var(--md-primary)" }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--md-on-surface-variant)" }} className="text-[14px]">Loading...</div>
          )}
        </div>

        {/* Rating FABs — M3 spec: 56px regular FAB, 24px gap between */}
        {!isDone && currentName && (
          <div className="flex items-center justify-center gap-5 py-4 shrink-0">
            <button
              onClick={() => rateName("pass", "left")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-surface-container-highest)", color: "var(--md-on-surface-variant)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}
            >
              <Icon name="close" size={24} />
            </button>
            <button
              onClick={() => rateName("maybe", "up")}
              className="state-layer w-12 h-12 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-tertiary-container)", color: "var(--md-on-tertiary-container)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}
            >
              <Icon name="help" size={22} />
            </button>
            <button
              onClick={() => rateName("love", "right")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", boxShadow: "0 2px 6px rgba(180,36,90,0.3), 0 1px 3px rgba(0,0,0,0.1)" }}
            >
              <Icon name="favorite" filled size={24} />
            </button>
          </div>
        )}

        {/* Swipe hint — only on first name ever */}
        {ratedCount === 0 && currentName && !isDone && (
          <p className="text-center text-[12px] leading-[16px] pb-5 -mt-2 shrink-0" style={{ color: "var(--md-outline)", fontFamily: "var(--font-body)" }}>
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
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-medium shrink-0" style={{ background: accent || "var(--md-primary-container)", color: accent ? "var(--md-on-tertiary-container)" : "var(--md-on-primary-container)", fontFamily: "var(--font-display)" }}>
            {name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] leading-[24px] font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
              {renderNameWithHighlight(name, "card")}
            </div>
            {data && (
              <div className="text-[12px] leading-[16px] truncate" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                {data.origin} &middot; {data.meaning}
              </div>
            )}
          </div>
          <button onClick={() => removeFromShortlist(name)} className="state-layer w-10 h-10 flex items-center justify-center rounded-full shrink-0" style={{ color: "var(--md-on-surface-variant)" }}>
            <Icon name="close" size={20} />
          </button>
        </div>
      );
    };

    return (
      <div className="min-h-dvh flex flex-col mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Shortlist"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={<IconButton icon="content_copy" onClick={exportShortlist} label="Copy" />}
        />
        <div className="flex-1 overflow-y-auto">
          {loves.length > 0 && (
            <div className="mb-2">
              <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[1px] leading-[16px]" style={{ color: "var(--md-primary)", fontFamily: "var(--font-body)" }}>
                Loved ({loves.length})
              </div>
              <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
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
              <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[1px] leading-[16px]" style={{ color: "var(--md-tertiary)", fontFamily: "var(--font-body)" }}>
                Maybe ({maybes.length})
              </div>
              <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
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
              <Icon name="favorite" size={48} style={{ color: "var(--md-outline-variant)" }} />
              <p className="mt-4 text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Your shortlist is empty</p>
              <p className="text-[12px] leading-[16px] mt-1" style={{ color: "var(--md-outline)", fontFamily: "var(--font-body)" }}>Names you love or maybe will appear here</p>
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
            <div className="text-[16px] leading-[24px] font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
              {renderNameWithHighlight(name, "card")}
              <span className="ml-2 text-[14px] font-normal" style={{ color: "var(--md-on-surface-variant)" }}>
                {renderNameWithHighlight(name, "fullname")}
              </span>
            </div>
            {data && (
              <div className="text-[12px] leading-[16px] mt-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                {data.origin} &middot; {data.meaning} &middot; {data.phonetic}
              </div>
            )}
          </div>
        </div>
      );
    };

    const Section = ({ title, icon, names, color, border }: { title: string; icon: string; names: string[]; color: string; border: string }) => names.length === 0 ? null : (
      <div className="mb-4">
        <div className="flex items-center gap-3 px-4 py-3">
          <Icon name={icon} filled size={20} style={{ color }} />
          <span className="text-[11px] font-medium uppercase tracking-[1px] leading-[16px]" style={{ color, fontFamily: "var(--font-body)" }}>
            {title} ({names.length})
          </span>
        </div>
        <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
          {names.map((name, i) => (
            <div key={name}>
              {i > 0 && <div className="ml-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
              <CompareCard name={name} border={border} />
            </div>
          ))}
        </div>
      </div>
    );

    const hasMatches = compareData && (compareData.bothLoved.length > 0 || compareData.oneLovedOneMaybe.length > 0 || compareData.bothMaybe.length > 0);

    return (
      <div className="min-h-dvh flex flex-col mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Compare"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={hasMatches && loveCount >= 2 ? (
            <button
              onClick={() => setView("pickFirstNames")}
              className="state-layer h-10 px-4 rounded-full text-[14px] font-medium"
              style={{ color: "var(--md-primary)", fontFamily: "var(--font-display)" }}
            >
              Middle names
            </button>
          ) : undefined}
        />
        <div className="flex-1 overflow-y-auto">
          {!compareData ? (
            <div className="text-center mt-24 text-[14px]" style={{ color: "var(--md-on-surface-variant)" }}>Loading...</div>
          ) : (
            <>
              <Section title="Both loved" icon="favorite" names={compareData.bothLoved} color="var(--md-primary)" border="var(--md-primary)" />
              <Section title="One love, one maybe" icon="thumbs_up_down" names={compareData.oneLovedOneMaybe} color="var(--md-tertiary)" border="var(--md-tertiary)" />
              <Section title="Both maybe" icon="help" names={compareData.bothMaybe} color="var(--md-outline)" border="var(--md-outline)" />
              {!hasMatches && (
                <div className="text-center mt-24 px-8">
                  <Icon name="compare" size={48} style={{ color: "var(--md-outline-variant)" }} />
                  <p className="mt-4 text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>No matches yet</p>
                  <p className="text-[12px] leading-[16px] mt-1" style={{ color: "var(--md-outline)", fontFamily: "var(--font-body)" }}>Both partners need to rate names first</p>
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
      <div>
        <label className="text-[12px] leading-[16px] font-medium mb-2 block" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
          {label}{required && " *"}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[56px] px-4 rounded-[12px] border text-[16px] leading-[24px] focus:outline-none transition-colors"
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
      <div className="min-h-dvh flex flex-col mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Add a name"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={undefined}
        />
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          <div className="rounded-[16px] p-6 space-y-6" style={{ background: "var(--md-surface-container-lowest)" }}>
            <TextField label="Name" value={addNameForm.name} onChange={(v) => setAddNameForm({ ...addNameForm, name: v })} placeholder="e.g. Mila" required />
            <TextField label="Origin" value={addNameForm.origin} onChange={(v) => setAddNameForm({ ...addNameForm, origin: v })} placeholder="e.g. Ukrainian" />
            <TextField label="Meaning" value={addNameForm.meaning} onChange={(v) => setAddNameForm({ ...addNameForm, meaning: v })} placeholder="e.g. Gracious, dear" />
            <TextField label="Phonetic" value={addNameForm.phonetic} onChange={(v) => setAddNameForm({ ...addNameForm, phonetic: v })} placeholder="e.g. MEE-lah" />
            <TextField label="Nicknames" value={addNameForm.nicknames} onChange={(v) => setAddNameForm({ ...addNameForm, nicknames: v })} placeholder="e.g. Mi, Mimi" />
            <button
              onClick={submitAddName}
              disabled={!addNameForm.name.trim()}
              className="state-layer w-full h-[40px] rounded-full text-[14px] font-medium tracking-[0.1px] transition-opacity disabled:opacity-40"
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

  // ===== PICK FIRST NAMES (for middle name phase) =====
  if (view === "pickFirstNames") {
    const loves = progress ? Object.entries(progress.ratings).filter(([, r]) => r === "love").map(([n]) => n) : [];
    const maybes = progress ? Object.entries(progress.ratings).filter(([, r]) => r === "maybe").map(([n]) => n) : [];
    const candidates = [...loves, ...maybes];

    return (
      <div className="min-h-dvh flex flex-col mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Pick first names"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={undefined}
        />
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          <div className="mb-6">
            <h2 className="text-[16px] leading-[24px] font-medium mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
              Choose your top first names
            </h2>
            <p className="text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
              Select 2-5 first names to pair with middle names. You&apos;ll rate middle names in context: &quot;[First] _____ Janszyn&quot;
            </p>
          </div>

          <div className="rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
            {candidates.map((name, i) => {
              const isSelected = selectedFirstNames.has(name);
              const data = nameMap.get(name);
              return (
                <div key={name}>
                  {i > 0 && <div className="ml-[72px] border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
                  <button
                    onClick={() => {
                      const next = new Set(selectedFirstNames);
                      if (next.has(name)) next.delete(name);
                      else if (next.size < 5) next.add(name);
                      setSelectedFirstNames(next);
                    }}
                    className="state-layer w-full flex items-center gap-4 px-4 py-3 text-left"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        background: isSelected ? "var(--md-primary)" : "var(--md-primary-container)",
                        color: isSelected ? "var(--md-on-primary)" : "var(--md-on-primary-container)",
                      }}
                    >
                      {isSelected ? <Icon name="check" size={20} /> : <span className="text-[14px] font-medium" style={{ fontFamily: "var(--font-display)" }}>{name[0]}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] leading-[24px] font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
                        {name}
                      </div>
                      {data && (
                        <div className="text-[12px] leading-[16px] truncate" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                          {data.origin} &middot; {data.meaning}
                        </div>
                      )}
                    </div>
                    <div className="text-[12px] leading-[16px] shrink-0 px-2 h-6 rounded flex items-center" style={{
                      background: loves.includes(name) ? "var(--md-primary-container)" : "var(--md-tertiary-container)",
                      color: loves.includes(name) ? "var(--md-on-primary-container)" : "var(--md-on-tertiary-container)",
                      fontFamily: "var(--font-body)",
                    }}>
                      {loves.includes(name) ? "Loved" : "Maybe"}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {candidates.length === 0 && (
            <div className="text-center mt-16 px-8">
              <Icon name="favorite" size={48} style={{ color: "var(--md-outline-variant)" }} />
              <p className="mt-4 text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                Rate some first names first
              </p>
            </div>
          )}

          <div className="h-24" />
        </div>

        {/* Bottom action */}
        {selectedFirstNames.size >= 2 && (
          <div className="px-4 pb-6 pt-3" style={{ background: "var(--md-surface-container-low)" }}>
            <button
              onClick={startMiddleNamePhase}
              className="state-layer w-full h-[56px] rounded-full text-[14px] font-medium tracking-[0.1px]"
              style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
            >
              Rate middle names for {selectedFirstNames.size} names
            </button>
          </div>
        )}

        <Snackbar />
      </div>
    );
  }

  // ===== RATE MIDDLE NAMES =====
  if (view === "rateMiddle") {
    const middleOrder = progress?.middleNameOrder || [];
    const middleIdx = progress?.middleNameIndex || 0;
    const activeFirst = progress?.activeFirstName || "";
    const topFirstNames = progress?.topFirstNames || [];
    const currentMiddle = middleOrder[middleIdx];
    const middleRatingsForFirst = progress?.middleNameRatings?.[activeFirst] || {};
    const middleRatedCount = Object.keys(middleRatingsForFirst).length;
    const isDone = middleIdx >= middleOrder.length;
    const currentMiddleData = middleNameList.find(m => m.name === currentMiddle);

    return (
      <div className="flex flex-col min-h-dvh mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Middle names"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rate")} />}
          trailing={
            <button
              onClick={() => setView("pairings")}
              className="state-layer h-10 px-3 rounded-full text-[14px] font-medium"
              style={{ color: "var(--md-primary)", fontFamily: "var(--font-display)" }}
            >
              Pairings
            </button>
          }
        />

        {/* First name tabs */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-1 overflow-x-auto">
          {topFirstNames.map(fn => (
            <button
              key={fn}
              onClick={() => switchActiveFirstName(fn)}
              className="state-layer shrink-0 h-8 px-4 rounded-lg text-[12px] font-medium leading-[16px] border transition-colors"
              style={{
                background: fn === activeFirst ? "var(--md-primary-container)" : "transparent",
                color: fn === activeFirst ? "var(--md-on-primary-container)" : "var(--md-on-surface-variant)",
                borderColor: fn === activeFirst ? "var(--md-primary-container)" : "var(--md-outline)",
                fontFamily: "var(--font-body)",
              }}
            >
              {fn}
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="px-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] leading-[16px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
              {middleRatedCount} rated for {activeFirst}
            </span>
            <span className="text-[12px] leading-[16px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
              {middleOrder.length - middleIdx} left
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-indicator" style={{ width: `${middleOrder.length > 0 ? (middleIdx / middleOrder.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Card */}
        <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
          {isDone ? (
            <div className="text-center px-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "var(--md-primary-container)" }}>
                <Icon name="celebration" filled size={32} style={{ color: "var(--md-on-primary-container)" }} />
              </div>
              <h2 className="text-[24px] font-normal mb-2" style={{ fontFamily: "var(--font-display)" }}>Done with {activeFirst}!</h2>
              <p className="text-[14px] leading-[20px] mb-8" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                {topFirstNames.length > 1 ? "Switch to another first name above, or view your pairings." : "View your final pairings."}
              </p>
              <button
                onClick={() => setView("pairings")}
                className="state-layer h-[40px] px-6 rounded-full text-[14px] font-medium tracking-[0.1px]"
                style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", fontFamily: "var(--font-display)" }}
              >
                View Pairings
              </button>
            </div>
          ) : currentMiddle ? (
            <div
              ref={cardRef}
              className={`w-full max-w-sm rounded-[28px] overflow-hidden ${swipeClass || "card-enter"}`}
              style={{ background: "var(--md-surface-container-lowest)", boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05)", position: "relative" }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {dragHint === "love" && <div className="swipe-hint-love" />}
              {dragHint === "pass" && <div className="swipe-hint-pass" />}
              {dragHint === "maybe" && <div className="swipe-hint-maybe" />}
              {/* Context header */}
              <div className="px-6 pt-5 pb-2 text-center">
                <p className="text-[14px] leading-[20px] mb-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
                  Middle name for
                </p>
                <p className="text-[18px] leading-[24px] font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-primary)" }}>
                  {activeFirst} _____ Janszyn
                </p>
              </div>

              {/* Middle name */}
              <div className="px-6 pt-4 pb-4 text-center">
                <h2 className="text-[36px] font-medium mb-2" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.5px", color: "var(--md-on-surface)" }}>
                  {currentMiddle}
                </h2>
                <p className="text-[16px] leading-[24px] mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface-variant)" }}>
                  {activeFirst} {currentMiddle} Janszyn
                </p>
                <button
                  onClick={() => speak(`${activeFirst} ${currentMiddle} Janszyn`)}
                  className="state-layer w-10 h-10 flex items-center justify-center rounded-full mx-auto"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  <Icon name="volume_up" size={20} />
                </button>
              </div>

              {/* Middle name info */}
              {currentMiddleData && (
                <div className="px-6 pb-6">
                  <div className="flex items-center gap-4 py-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                    <Icon name="public" size={20} style={{ color: "var(--md-on-surface-variant)" }} />
                    <div className="flex-1">
                      <div className="text-[11px] leading-[16px] tracking-[0.5px] uppercase" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Origin</div>
                      <div className="text-[14px] leading-[20px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>{currentMiddleData.origin}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] leading-[16px] tracking-[0.5px] uppercase" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Syllables</div>
                      <div className="text-[14px] leading-[20px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>{currentMiddleData.syllables}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 py-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
                    <Icon name="lightbulb" size={20} style={{ color: "var(--md-on-surface-variant)" }} />
                    <div className="flex-1">
                      <div className="text-[11px] leading-[16px] tracking-[0.5px] uppercase" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>Meaning</div>
                      <div className="text-[14px] leading-[20px] font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--font-body)" }}>{currentMiddleData.meaning}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--md-on-surface-variant)" }} className="text-[14px]">Loading...</div>
          )}
        </div>

        {/* Rating FABs */}
        {!isDone && currentMiddle && (
          <div className="flex items-center justify-center gap-5 py-4 shrink-0">
            <button
              onClick={() => rateMiddleName(currentMiddle, "pass", "left")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-surface-container-highest)", color: "var(--md-on-surface-variant)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}
            >
              <Icon name="close" size={24} />
            </button>
            <button
              onClick={() => rateMiddleName(currentMiddle, "maybe", "up")}
              className="state-layer w-12 h-12 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-tertiary-container)", color: "var(--md-on-tertiary-container)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }}
            >
              <Icon name="help" size={22} />
            </button>
            <button
              onClick={() => rateMiddleName(currentMiddle, "love", "right")}
              className="state-layer w-14 h-14 flex items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ background: "var(--md-primary)", color: "var(--md-on-primary)", boxShadow: "0 2px 6px rgba(180,36,90,0.3), 0 1px 3px rgba(0,0,0,0.1)" }}
            >
              <Icon name="favorite" filled size={24} />
            </button>
          </div>
        )}
        <Snackbar />
      </div>
    );
  }

  // ===== PAIRINGS =====
  if (view === "pairings") {
    const topFirstNames = progress?.topFirstNames || [];
    const middleRatings = progress?.middleNameRatings || {};

    // Build pairings sorted by rating
    type Pairing = { first: string; middle: string; rating: Rating };
    const pairings: Pairing[] = [];
    topFirstNames.forEach(fn => {
      const ratings = middleRatings[fn] || {};
      Object.entries(ratings).forEach(([middle, rating]) => {
        if (rating !== "pass") pairings.push({ first: fn, middle, rating });
      });
    });
    // Sort: love first, then maybe
    pairings.sort((a, b) => {
      if (a.rating === "love" && b.rating !== "love") return -1;
      if (a.rating !== "love" && b.rating === "love") return 1;
      return 0;
    });

    const loved = pairings.filter(p => p.rating === "love");
    const maybes = pairings.filter(p => p.rating === "maybe");

    const PairingCard = ({ p, accent }: { p: Pairing; accent: string }) => (
      <div className="flex items-center gap-4 px-4 py-4" style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] leading-[24px] font-medium" style={{ fontFamily: "var(--font-display)", color: "var(--md-on-surface)" }}>
            {p.first} {p.middle} Janszyn
          </div>
          <div className="text-[12px] leading-[16px] mt-1" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>
            {middleNameList.find(m => m.name === p.middle)?.meaning || ""}
          </div>
        </div>
        <button
          onClick={() => speak(`${p.first} ${p.middle} Janszyn`)}
          className="state-layer w-10 h-10 flex items-center justify-center rounded-full shrink-0"
          style={{ color: "var(--md-on-surface-variant)" }}
        >
          <Icon name="volume_up" size={20} />
        </button>
      </div>
    );

    return (
      <div className="min-h-dvh flex flex-col mx-auto" style={{ background: "var(--md-surface-container-low)", maxWidth: 430 }}>
        <TopBar
          title="Final pairings"
          leading={<IconButton icon="arrow_back" onClick={() => setView("rateMiddle")} />}
          trailing={undefined}
        />
        <div className="flex-1 overflow-y-auto">
          {loved.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-3 px-4 py-3">
                <Icon name="favorite" filled size={20} style={{ color: "var(--md-primary)" }} />
                <span className="text-[11px] font-medium uppercase tracking-[1px] leading-[16px]" style={{ color: "var(--md-primary)", fontFamily: "var(--font-body)" }}>
                  Loved ({loved.length})
                </span>
              </div>
              <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
                {loved.map((p, i) => (
                  <div key={`${p.first}-${p.middle}`}>
                    {i > 0 && <div className="ml-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
                    <PairingCard p={p} accent="var(--md-primary)" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {maybes.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-3 px-4 py-3">
                <Icon name="help" size={20} style={{ color: "var(--md-tertiary)" }} />
                <span className="text-[11px] font-medium uppercase tracking-[1px] leading-[16px]" style={{ color: "var(--md-tertiary)", fontFamily: "var(--font-body)" }}>
                  Maybe ({maybes.length})
                </span>
              </div>
              <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: "var(--md-surface-container-lowest)" }}>
                {maybes.map((p, i) => (
                  <div key={`${p.first}-${p.middle}`}>
                    {i > 0 && <div className="ml-4 border-t" style={{ borderColor: "var(--md-outline-variant)" }} />}
                    <PairingCard p={p} accent="var(--md-tertiary)" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {pairings.length === 0 && (
            <div className="text-center mt-24 px-8">
              <Icon name="child_care" size={48} style={{ color: "var(--md-outline-variant)" }} />
              <p className="mt-4 text-[14px] leading-[20px]" style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--font-body)" }}>No pairings yet</p>
              <p className="text-[12px] leading-[16px] mt-1" style={{ color: "var(--md-outline)", fontFamily: "var(--font-body)" }}>Rate some middle names first</p>
            </div>
          )}
          <div className="h-8" />
        </div>
        <Snackbar />
      </div>
    );
  }

  return null;
}
