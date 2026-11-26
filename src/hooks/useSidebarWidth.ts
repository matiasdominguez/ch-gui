import { useEffect, useState } from "react";

const MIN_NAV_W = 280;
const MIN_EDITOR_W = 360;
const MAX_NAV_W = 640;
const MAX_NAV_SHARE = 0.35;
const DEFAULT_NAV_W = 320;
const STORAGE_KEY = "ch-gui.nav-width";

export function maxNavW(windowW: number): number {
  return Math.max(
    MIN_NAV_W,
    Math.min(MAX_NAV_W, windowW * MAX_NAV_SHARE, windowW - MIN_EDITOR_W),
  );
}

export function useSidebarWidth() {
  const [preferred, setPreferred] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_NAV_W && saved <= MAX_NAV_W
      ? saved
      : DEFAULT_NAV_W;
  });
  const [windowW, setWindowW] = useState(() => window.innerWidth);
  const navWidth = Math.min(preferred, maxNavW(windowW));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(preferred));
  }, [preferred]);

  useEffect(() => {
    function onResize() {
      setWindowW(window.innerWidth);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function startNavResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startPreferred = preferred;
    const startW = navWidth;
    // A commit re-renders App and re-lays out Monaco, so commit once per frame.
    let latestX = startX;
    let rafId: number | null = null;
    function flush() {
      rafId = null;
      const max = maxNavW(window.innerWidth);
      const next = Math.max(
        MIN_NAV_W,
        Math.min(max, startW + latestX - startX),
      );
      // A drag that ends at its start size, even against the window cap, keeps
      // the earlier preference, so a capped size never replaces it.
      setPreferred(next === startW ? startPreferred : next);
    }
    function onMove(me: MouseEvent) {
      latestX = me.clientX;
      if (rafId != null) return;
      rafId = requestAnimationFrame(flush);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flush();
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { navWidth, startNavResize };
}
