import { useEffect, useState } from "react";

const MIN_EDITOR_H = 90;
const MIN_RESULTS_H = 140;
const MAX_EDITOR_SHARE = 0.45;
const DEFAULT_EDITOR_H = 260;
const STORAGE_KEY = "ch-gui.editor-height";

export function maxEditorH(windowH: number): number {
  return Math.max(
    MIN_EDITOR_H,
    Math.min(windowH - MIN_RESULTS_H, windowH * MAX_EDITOR_SHARE),
  );
}

export function useEditorHeight() {
  const [preferred, setPreferred] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_EDITOR_H
      ? saved
      : DEFAULT_EDITOR_H;
  });
  const [windowH, setWindowH] = useState(() => window.innerHeight);
  const editorHeight = Math.min(preferred, maxEditorH(windowH));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(preferred));
  }, [preferred]);

  useEffect(() => {
    function onResize() {
      setWindowH(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function startEditorResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startPreferred = preferred;
    const startH = editorHeight;
    // Monaco re-lays out on every height change, so commit once per frame.
    let latestY = startY;
    let rafId: number | null = null;
    function flush() {
      rafId = null;
      const max = maxEditorH(window.innerHeight);
      const next = Math.max(
        MIN_EDITOR_H,
        Math.min(max, startH + latestY - startY),
      );
      // A drag that ends at its start size, even against the window cap, keeps
      // the earlier preference, so a capped size never replaces it.
      setPreferred(next === startH ? startPreferred : next);
    }
    function onMove(me: MouseEvent) {
      latestY = me.clientY;
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
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { editorHeight, startEditorResize };
}
