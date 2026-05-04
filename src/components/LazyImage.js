import React, { useEffect, useRef, useState } from "react";

// LazyImage — defers `<img src=...>` mount until the container enters the viewport. Hundreds
// of off-screen UnitCard / FactionIcon components no longer all hit the rticon protocol at
// once; only ~the visible window does, the rest stream in as the user scrolls.
//
// rootMargin lets us pre-fetch the next page of images just before they scroll in (smoother
// scroll). Once an image becomes visible we keep it mounted forever — re-mounting would
// re-trigger the network request needlessly.
export default function LazyImage({ src, alt, width, height, style, title, draggable, onContextMenu, onError, fallback, rootMargin = "200px" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (visible) return; // already in view — keep it
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setVisible(true); obs.disconnect(); break; }
      }
    }, { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

  if (failed && fallback) {
    return <span ref={ref}>{fallback}</span>;
  }

  // Placeholder takes the same dimensions as the eventual image so layout stays stable
  // (no jank when the image swaps in).
  return (
    <span ref={ref} style={{ display: "inline-block", width, height, ...style && { borderRadius: style.borderRadius }, position: "relative" }}>
      {visible && src && !failed && (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          title={title}
          draggable={draggable}
          onContextMenu={onContextMenu}
          onError={() => { setFailed(true); if (onError) onError(); }}
          loading="lazy"
          decoding="async"
          style={style}
        />
      )}
    </span>
  );
}
