import { useEffect } from "react";

// Watches for elements with the `.reveal` class (rendered now or added later, e.g. once
// async data loads) and adds `.is-visible` the moment each one scrolls into view. Call once
// per page component; safe to call on every render since already-revealed elements are skipped.
// Deliberately scoped to `.reveal`/`.feature-grid article` only - NOT `.panel`/`.order-card`,
// which live-refresh constantly on kitchen/service/admin boards. Blurring those in on every
// WebSocket-driven update (e.g. an order card moving to a new status column) reads as a
// rendering glitch, not a nice entrance effect.
const REVEAL_SELECTOR = ".reveal, .feature-grid article";

export function useScrollReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll(
      Array.from(REVEAL_SELECTOR.split(", "), (part) => `${part}:not(.is-visible)`).join(", ")
    );
    if (!elements.length) return undefined;

    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
}
