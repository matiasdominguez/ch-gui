import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { maxEditorH, useEditorHeight } from "./useEditorHeight";
import { maxNavW, useSidebarWidth } from "./useSidebarWidth";

function resize(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", {
    value: h,
    configurable: true,
  });
  window.dispatchEvent(new Event("resize"));
}

const original = { w: window.innerWidth, h: window.innerHeight };

beforeEach(() => window.localStorage.clear());
afterEach(() => resize(original.w, original.h));

describe("sidebar width", () => {
  it("takes at most 35% of a small window", () => {
    expect(maxNavW(1000)).toBe(350);
    expect(maxNavW(1600)).toBe(560);
    expect(maxNavW(2400)).toBe(640);
    expect(maxNavW(600)).toBe(280);
  });

  it("shrinks with the window and grows back to the saved width", () => {
    window.localStorage.setItem("ch-gui.nav-width", "500");
    resize(1600, 900);
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.navWidth).toBe(500);
    act(() => resize(1000, 640));
    expect(result.current.navWidth).toBe(350);
    act(() => resize(1600, 900));
    expect(result.current.navWidth).toBe(500);
  });
});

describe("editor height", () => {
  it("leaves most of a short window to results", () => {
    expect(maxEditorH(640)).toBe(288);
    expect(maxEditorH(200)).toBe(90);
  });

  it("shrinks with the window and grows back to the saved height", () => {
    window.localStorage.setItem("ch-gui.editor-height", "400");
    resize(1400, 1000);
    const { result } = renderHook(() => useEditorHeight());
    expect(result.current.editorHeight).toBe(400);
    act(() => resize(1400, 640));
    expect(result.current.editorHeight).toBe(288);
    act(() => resize(1400, 1000));
    expect(result.current.editorHeight).toBe(400);
  });
});

describe("splitter click", () => {
  it("keeps the saved width when the splitter is clicked without a drag", () => {
    window.localStorage.setItem("ch-gui.nav-width", "500");
    resize(1000, 640);
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.navWidth).toBe(350);
    act(() =>
      result.current.startNavResize({
        preventDefault() {},
        clientX: 350,
      } as unknown as React.MouseEvent),
    );
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    act(() => resize(1600, 900));
    expect(result.current.navWidth).toBe(500);
  });

  it("keeps the saved width when a drag returns to its start", () => {
    window.localStorage.setItem("ch-gui.nav-width", "500");
    resize(1000, 640);
    const { result } = renderHook(() => useSidebarWidth());
    act(() =>
      result.current.startNavResize({
        preventDefault() {},
        clientX: 350,
      } as unknown as React.MouseEvent),
    );
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 350 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    act(() => resize(1600, 900));
    expect(result.current.navWidth).toBe(500);
  });

  it("keeps the saved width when a drag pushes against the cap", () => {
    window.localStorage.setItem("ch-gui.nav-width", "500");
    resize(1000, 640);
    const { result } = renderHook(() => useSidebarWidth());
    act(() =>
      result.current.startNavResize({
        preventDefault() {},
        clientX: 350,
      } as unknown as React.MouseEvent),
    );
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 420 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(result.current.navWidth).toBe(350);
    act(() => resize(1600, 900));
    expect(result.current.navWidth).toBe(500);
  });
});
