import React, { useState } from "react";
import { useLightbox } from "./UnitCard";
import LazyImage from "./LazyImage";

// Faction icon — pulls the PNG from the rticon:// custom protocol. Main process decodes the
// TGA once, caches the PNG to userData/icon_cache, and serves bytes directly. The renderer
// does no decoding at all; the browser just loads it like any other image.
export function preloadIcon() { return Promise.resolve(); /* no-op — protocol is lazy */ }

export default function FactionIcon({ iconPath, alt = "", size = 84, tightCrop = false, modIconsDir }) {
  const lightbox = useLightbox();
  // iconPath is "faction_icons/<id>.tga". Pull just the id and pass to the protocol.
  const factionName = iconPath.replace("faction_icons/", "").replace(/\.(png|tga)$/, "");
  const url = `rticon://faction/${encodeURIComponent(factionName)}`;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: 6, background: "rgba(80,80,80,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: size * 0.3, color: "#888" }}>{alt?.[0]?.toUpperCase() || "?"}</span>
      </div>
    );
  }

  return (
    <LazyImage
      src={url}
      alt={alt}
      width={size}
      height={size}
      title={alt ? `${alt} — right-click to view full size` : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        if (lightbox) lightbox.open(url, alt);
      }}
      style={{
        display: "block",
        width: size,
        height: size,
        objectFit: tightCrop ? "cover" : "contain",
        borderRadius: 6,
        background: "transparent",
        cursor: "context-menu",
      }}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
