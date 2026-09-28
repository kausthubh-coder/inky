import { useLayoutEffect, type RefObject } from "react";
import type { SchoolPageBounds } from "../../shared/index.js";

// The live school page is a native layer above the screen, so nothing can be drawn on top of it.
// It hides while a dialog, the account menu or a homework menu is open, and whenever the slot isn't shown.
const COVERS = "dialog[open]:not(.workspace-dialog), .rd-nested-sheet[open], .account-menu, .hw-menu";

export function useSchoolSlot(slot: RefObject<HTMLElement | null>, onSlot: (bounds: SchoolPageBounds | null) => void, active = true): void {
  useLayoutEffect(() => {
    if (!active) {
      onSlot(null);
      return undefined;
    }
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.current?.getBoundingClientRect();
        if (!rect || rect.width < 1 || rect.height < 1 || document.querySelector(COVERS)) {
          onSlot(null);
          return;
        }
        onSlot({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
      });
    };
    const resize = new ResizeObserver(report);
    if (slot.current) resize.observe(slot.current);
    const mutations = new MutationObserver(report);
    mutations.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true, childList: true });
    window.addEventListener("resize", report);
    report();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", report);
      onSlot(null);
    };
  }, [onSlot, active, slot]);
}
