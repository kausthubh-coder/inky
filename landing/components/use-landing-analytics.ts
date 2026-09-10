"use client";

import { useEffect, type RefObject } from "react";
import { track } from "../lib/analytics";

/** Once per page mount, count sections actually on screen and scroll milestones. */
export function useLandingAnalytics(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = entry.target.id;
        track("landing_section_viewed", { section });
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.25 });
    for (const id of ["what", "wait", "faq"]) {
      const section = page.querySelector(`#${id}`);
      if (section) observer.observe(section);
    }
    const reached = new Set<number>();
    let frame = 0;
    function measureScroll() {
      frame = 0;
      const range = document.documentElement.scrollHeight - window.innerHeight;
      if (range <= 0) return;
      const depth = Math.round(window.scrollY / range * 100);
      for (const percent of [25, 50, 75, 100]) {
        if (depth >= percent && !reached.has(percent)) {
          reached.add(percent);
          track("landing_scroll_depth", { percent });
        }
      }
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(measureScroll);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    measureScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pageRef]);
}
