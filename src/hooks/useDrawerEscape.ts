import { useEffect, useId, useRef } from "react";

let closeOpenDrawer: { owner: string; close: () => void } | null = null;

/** Mantine's Drawer handles Escape on the whole window, which would take it
 * from the editor's autocomplete, the params bar, and modals opened on top. */
export function useDrawerEscape(opened: boolean, onClose: () => void): string {
  const drawerClass = `chg-drawer-${useId().replace(/[^\w-]/g, "")}`;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!opened) return;
    const close = () => closeRef.current();
    if (closeOpenDrawer && closeOpenDrawer.owner !== drawerClass)
      closeOpenDrawer.close();
    closeOpenDrawer = { owner: drawerClass, close };

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
      if (document.querySelector(".mantine-Modal-content")) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.getAttribute("data-mantine-stop-propagation") === "true")
        return;
      if (target?.closest('[role="menu"], .mantine-Popover-dropdown')) return;
      const inDrawer = target?.closest(".mantine-Drawer-root");
      const mine = inDrawer
        ? inDrawer.classList.contains(drawerClass)
        : !target || target === document.body || target.tagName === "BUTTON";
      if (mine) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (closeOpenDrawer?.owner === drawerClass) closeOpenDrawer = null;
    };
  }, [opened, drawerClass]);
  return drawerClass;
}
