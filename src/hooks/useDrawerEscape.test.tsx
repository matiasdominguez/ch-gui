import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDrawerEscape } from "./useDrawerEscape";

function pressEscape(target: Element) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

function add(className: string, parent: Element = document.body) {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

function drawer(cls: string) {
  return add(
    "x",
    add("mantine-Drawer-content", add(`mantine-Drawer-root ${cls}`)),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDrawerEscape", () => {
  it("closes on Escape inside it, on a button, or with nothing focused", () => {
    const onClose = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDrawerEscape(true, onClose),
    );
    pressEscape(drawer(result.current));
    pressEscape(document.body);
    const row = document.createElement("button");
    document.body.appendChild(row);
    pressEscape(row);
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("leaves Escape elsewhere to its owner", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useDrawerEscape(true, onClose));
    pressEscape(add("x", add("monaco-editor")));
    pressEscape(add("params-bar-input"));
    const item = document.createElement("button");
    add("mantine-Popover-dropdown").appendChild(item);
    item.setAttribute("role", "menuitem");
    pressEscape(item);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores Escape while a modal is open", () => {
    const onClose = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDrawerEscape(true, onClose),
    );
    add("mantine-Modal-content");
    pressEscape(drawer(result.current));
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("closes the open drawer when another opens", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = renderHook(() => useDrawerEscape(true, closeA));
    const b = renderHook(() => useDrawerEscape(true, closeB));
    expect(a.result.current).not.toBe(b.result.current);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    a.unmount();
    b.unmount();
  });

  it("keeps working when the caller passes a new close each render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ cb }) => useDrawerEscape(true, cb),
      { initialProps: { cb: first } },
    );
    rerender({ cb: second });
    pressEscape(document.body);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does nothing while the drawer is closed", () => {
    const onClose = vi.fn();
    renderHook(() => useDrawerEscape(false, onClose));
    pressEscape(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
