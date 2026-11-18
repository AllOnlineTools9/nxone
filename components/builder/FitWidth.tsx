"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Shows a page at a fixed width and shrinks it to fit, like a print preview, so on a phone or a
 * narrow column the whole document is visible at once instead of its right-hand side being cut
 * off. Where there is room to show it at full size, it does nothing.
 */
export default function FitWidth({ width, enabled = true, children }: { width: number; enabled?: boolean; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outer.current;
    if (!el || !enabled) { setScale(1); return; }
    const measure = () => setScale(Math.min(1, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, enabled]);

  return (
    <div ref={outer} className="w-full min-w-0">
      {/* zoom, unlike transform, also shrinks the space the page takes, so nothing below overlaps. */}
      <div style={enabled && scale < 1 ? { width, zoom: scale } : undefined}>{children}</div>
    </div>
  );
}
