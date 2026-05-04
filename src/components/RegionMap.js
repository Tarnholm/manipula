import React, { useEffect, useMemo, useRef, useState } from "react";
import { regionsByRgbKey } from "../parsers/regions";

// RegionMap — recruitable-region visualiser with multiple view modes.
//   • recruit   → green = unit can recruit here (unit-specific gates applied)
//   • faction   → tint each region by its descr_strat owner's primary colour
//   • density   → tint each region by how many of *all* authored units recruit there
//   • compare   → green where both selected units recruit, blue/red where only one does
//
// Plus: zoom/pan, find-region search, click → side panel listing units that recruit in
// that region, export to PNG, right-click → quick-add HR clauses.

function buildGetColor(mode, ctx) {
  if (mode === "recruit") {
    const { matched } = ctx;
    return (region, r, g, b) => {
      if (!region) return [r, g, b];
      if (matched.has(region.rgbKey)) return [80, 200, 110];
      const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
      return [Math.round(lum * 0.55), Math.round(lum * 0.55), Math.round(lum * 0.55)];
    };
  }
  if (mode === "faction") {
    const { factionColors, regionOwner } = ctx;
    return (region, r, g, b) => {
      if (!region) return [r, g, b];
      const owner = (regionOwner && regionOwner[region.region]) || region.stratOwner || region.owner;
      const col = owner && factionColors[owner];
      if (!col) {
        const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
        return [Math.round(lum * 0.4), Math.round(lum * 0.4), Math.round(lum * 0.4)];
      }
      // Blend faction colour with the original tint to keep terrain readable underneath.
      return [Math.round(col[0] * 0.7 + r * 0.15), Math.round(col[1] * 0.7 + g * 0.15), Math.round(col[2] * 0.7 + b * 0.15)];
    };
  }
  if (mode === "density") {
    const { densityByKey, maxDensity } = ctx;
    return (region, r, g, b) => {
      if (!region) return [r, g, b];
      const d = densityByKey.get(region.rgbKey) || 0;
      if (d === 0) {
        const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
        return [Math.round(lum * 0.4), Math.round(lum * 0.4), Math.round(lum * 0.4)];
      }
      // Cool-to-hot gradient: 1 unit = blue, max = red.
      const t = Math.min(1, d / Math.max(1, maxDensity));
      const rr = Math.round(60 + t * 195);
      const gg = Math.round(120 - t * 80);
      const bb = Math.round(200 - t * 180);
      return [rr, gg, bb];
    };
  }
  if (mode === "compare") {
    const { matchedA, matchedB } = ctx;
    return (region, r, g, b) => {
      if (!region) return [r, g, b];
      const inA = matchedA.has(region.rgbKey);
      const inB = matchedB.has(region.rgbKey);
      if (inA && inB) return [80, 200, 110];
      if (inA) return [80, 140, 230];
      if (inB) return [230, 110, 110];
      const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
      return [Math.round(lum * 0.45), Math.round(lum * 0.45), Math.round(lum * 0.45)];
    };
  }
  if (mode === "tier") {
    // Earliest MIC tier at which the unit is recruitable in each region. GovD homeland
    // (homelandMicTier) is "earliest"; outside the homeland is canonicalMicTier. Regions
    // outside the unit's faction list are unreachable.
    const { matched, tierByKey } = ctx;
    return (region, r, g, b) => {
      if (!region) return [r, g, b];
      if (!matched.has(region.rgbKey)) {
        const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
        return [Math.round(lum * 0.4), Math.round(lum * 0.4), Math.round(lum * 0.4)];
      }
      const t = tierByKey.get(region.rgbKey) || 4;
      // 1 = bright gold, 2 = silver, 3 = bronze, 4 = dim red.
      if (t === 1) return [220, 180, 90];
      if (t === 2) return [200, 200, 210];
      if (t === 3) return [200, 150, 100];
      return [170, 110, 110];
    };
  }
  return (region, r, g, b) => [r, g, b];
}

function computeMatchedKeys(unit, regions, regionOwner) {
  if (!unit || !regions || regions.length === 0) return new Set();
  const allClauses = [
    ...(unit.commonRequires || []),
    ...(unit.outsideExtras || []),
    ...(unit.aor && unit.aor.enabled ? (unit.aorRequires || []) : []),
  ];
  const positiveHR = [], negativeHR = [];
  for (const c of allClauses) {
    let m;
    if ((m = String(c).match(/^not\s+hidden_resource\s+(\S+)$/))) negativeHR.push(m[1]);
    else if ((m = String(c).match(/^hidden_resource\s+(\S+)$/))) positiveHR.push(m[1]);
  }
  const facList = (unit.factions || []).filter(f => f && f !== "all");
  const exFacList = unit.excludeFactions || [];
  const out = new Set();
  for (const r of regions) {
    if (!r.rgbKey) continue;
    const owner = (regionOwner && regionOwner[r.region]) || r.stratOwner || r.owner;
    if (facList.length) {
      const ownerMatches = facList.some(f => f === owner || (owner && owner === f.split("_")[0]));
      if (!ownerMatches) continue;
    }
    if (exFacList.length && exFacList.includes(owner)) continue;
    if (positiveHR.length && !positiveHR.every(hr => r.traits.includes(hr))) continue;
    if (negativeHR.length && negativeHR.some(hr => r.traits.includes(hr))) continue;
    out.add(r.rgbKey);
  }
  return out;
}

export default function RegionMap({ unit, modIndex, allUnits, onAddRequire, onFilterFaction, onUnitClick }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pixels, setPixels] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  // Persist zoom/pan per unit so switching units returns to the user's last view of that
  // unit's recruitable map. Falls back to the global view when there's no per-unit entry.
  const viewKey = unit && unit.id ? `rt:mapView:${unit.id}` : "rt:mapView:_global";
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(viewKey) || localStorage.getItem("rt:mapView:_global") || "{}";
      const v = JSON.parse(raw);
      const z = parseFloat(v.zoom);
      setZoom(Number.isFinite(z) && z >= 1 && z <= 8 ? z : 1);
      setPan({ x: +(v.panX) || 0, y: +(v.panY) || 0 });
    } catch { setZoom(1); setPan({ x: 0, y: 0 }); }
    // eslint-disable-next-line
  }, [viewKey]);
  useEffect(() => {
    try { localStorage.setItem(viewKey, JSON.stringify({ zoom, panX: pan.x, panY: pan.y })); } catch {}
    // Also keep a global default for the very first mount before a unit is selected.
    try { localStorage.setItem("rt:mapView:_global", JSON.stringify({ zoom, panX: pan.x, panY: pan.y })); } catch {}
  }, [zoom, pan, viewKey]);
  // Region-search history.
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rt:mapSearchHistory") || "[]"); } catch { return []; }
  });
  const pushSearchHistory = (q) => {
    if (!q) return;
    const next = [q, ...searchHistory.filter(h => h !== q)].slice(0, 6);
    setSearchHistory(next);
    try { localStorage.setItem("rt:mapSearchHistory", JSON.stringify(next)); } catch {}
  };
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  const [mode, setMode] = useState("recruit");
  const [compareUnitId, setCompareUnitId] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [clickedRegion, setClickedRegion] = useState(null); // when set, shows the side panel
  // Brush-paint mode: when an HR is selected here, clicking a region toggles that HR in
  // descr_regions.txt for that region. Cursor changes to a paint pointer; the side panel
  // is suppressed while the brush is active.
  const [brushHR, setBrushHR] = useState("");
  const [brushMode, setBrushMode] = useState("toggle"); // "add" | "remove" | "toggle"
  const [brushStatus, setBrushStatus] = useState("");

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getMapRegionsPixels) { setError("map IPC unavailable"); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.getMapRegionsPixels().then(res => {
      if (cancelled) return;
      if (!res || !res.pixels) { setError("map_regions.tga not found"); setLoading(false); return; }
      setPixels({ width: res.width, height: res.height, data: new Uint8ClampedArray(res.pixels) });
      setLoading(false);
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const lookup = useMemo(() => regionsByRgbKey(modIndex.regions || []), [modIndex.regions]);
  const matched = useMemo(() => computeMatchedKeys(unit, modIndex.regions || [], modIndex.regionOwner || {}), [unit, modIndex.regions, modIndex.regionOwner]);
  // Tier mode: per-region earliest reachable MIC tier. GovD applies in the homeland (faction
  // owns the region); GovB/GovC outside it.
  const tierByKey = useMemo(() => {
    const m = new Map();
    if (mode !== "tier" || !unit) return m;
    const homelandTier = unit.homelandMicTier ?? unit.canonicalMicTier ?? 1;
    const canonical = unit.canonicalMicTier ?? unit.minTier ?? 1;
    const facList = (unit.factions || []).filter(f => f && f !== "all");
    for (const r of (modIndex.regions || [])) {
      if (!r.rgbKey || !matched.has(r.rgbKey)) continue;
      const owner = (modIndex.regionOwner && modIndex.regionOwner[r.region]) || r.stratOwner || r.owner;
      const isHomeland = facList.length > 0 && facList.some(f => f === owner || (owner && owner === f.split("_")[0]));
      m.set(r.rgbKey, isHomeland ? homelandTier : canonical);
    }
    return m;
  }, [mode, unit, modIndex.regions, modIndex.regionOwner, matched]);

  // Compare mode: compute matched set for the second unit too.
  const compareUnit = useMemo(() => (allUnits || []).find(u => u.id === compareUnitId), [allUnits, compareUnitId]);
  const matchedB = useMemo(() => computeMatchedKeys(compareUnit, modIndex.regions || [], modIndex.regionOwner || {}), [compareUnit, modIndex.regions, modIndex.regionOwner]);

  // Density mode: count how many authored units recruit in each region.
  const density = useMemo(() => {
    if (mode !== "density" || !allUnits) return { byKey: new Map(), max: 0 };
    const byKey = new Map();
    for (const u of allUnits) {
      if (u.enabled === false) continue;
      const ks = computeMatchedKeys(u, modIndex.regions || [], modIndex.regionOwner || {});
      for (const k of ks) byKey.set(k, (byKey.get(k) || 0) + 1);
    }
    let max = 0;
    for (const v of byKey.values()) if (v > max) max = v;
    return { byKey, max };
  }, [mode, allUnits, modIndex.regions, modIndex.regionOwner]);

  // Faction colour palette: faction id → [r, g, b] from descr_sm_factions, fallback to a hash.
  const factionColors = useMemo(() => {
    const map = {};
    for (const f of (modIndex.factions || [])) {
      if (f.primaryRGB) map[f.id] = f.primaryRGB;
    }
    // Synthesize a stable palette for factions without an explicit colour.
    let i = 0;
    for (const f of (modIndex.factions || [])) {
      if (map[f.id]) continue;
      // Hash-based hue so same id always gets same colour.
      let h = 0;
      for (let k = 0; k < f.id.length; k++) h = (h * 31 + f.id.charCodeAt(k)) >>> 0;
      const hue = h % 360;
      map[f.id] = hsvToRgb(hue, 0.6, 0.85);
      i++;
    }
    return map;
  }, [modIndex.factions]);

  // Repaint canvas. Each mode picks its own colouring function.
  useEffect(() => {
    if (!pixels || !canvasRef.current) return;
    const { width, height, data } = pixels;
    const out = new Uint8ClampedArray(width * height * 4);
    const ctx = {
      matched,
      matchedA: matched, matchedB,
      factionColors, regionOwner: modIndex.regionOwner || {},
      densityByKey: density.byKey, maxDensity: density.max,
      tierByKey,
    };
    const getColor = buildGetColor(mode, ctx);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const region = lookup[`${r},${g},${b}`];
      const col = getColor(region, r, g, b);
      out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2]; out[i + 3] = 255;
    }
    const c = canvasRef.current;
    c.width = width;
    c.height = height;
    c.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  }, [pixels, lookup, matched, matchedB, mode, factionColors, density, tierByKey, modIndex.regionOwner]);

  // Reset compare-unit picker when leaving compare mode.
  useEffect(() => { if (mode !== "compare") setCompareUnitId(null); }, [mode]);

  const pickRegionAt = (clientX, clientY) => {
    if (!pixels || !canvasRef.current || !containerRef.current) return null;
    const cRect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor(((clientX - cRect.left) / cRect.width) * pixels.width);
    const y = Math.floor(((clientY - cRect.top) / cRect.height) * pixels.height);
    if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return null;
    const idx = (y * pixels.width + x) * 4;
    const key = `${pixels.data[idx]},${pixels.data[idx + 1]},${pixels.data[idx + 2]}`;
    const containerRect = containerRef.current.getBoundingClientRect();
    return { region: lookup[key] || null, x: clientX - containerRect.left, y: clientY - containerRect.top };
  };

  const onMouseMove = (e) => {
    if (dragRef.current) {
      const d = dragRef.current;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true;
      setPan({ x: d.startPanX + dx, y: d.startPanY + dy });
      setHover(null);
      return;
    }
    const r = pickRegionAt(e.clientX, e.clientY);
    setHover(r && r.region ? r : null);
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
    dragMovedRef.current = false;
  };
  const onMouseUp = async (e) => {
    if (dragRef.current && !dragMovedRef.current) {
      const r = pickRegionAt(e.clientX, e.clientY);
      if (r && r.region) {
        if (brushHR && window.electronAPI?.toggleRegionHR) {
          // Brush mode — toggle the HR on this region in descr_regions.txt.
          const result = await window.electronAPI.toggleRegionHR(r.region.region, brushHR, brushMode);
          if (result && result.ok) {
            // Update the in-memory traits list so the map recolour reflects it instantly.
            const traits = r.region.traits.slice();
            if (result.applied === "added" && !traits.includes(brushHR)) traits.push(brushHR);
            else if (result.applied === "removed") {
              const idx = traits.indexOf(brushHR);
              if (idx >= 0) traits.splice(idx, 1);
            }
            r.region.traits = traits;
            setBrushStatus(`${result.applied} "${brushHR}" on ${r.region.region}`);
          } else {
            setBrushStatus(`failed: ${(result && result.reason) || "?"}`);
          }
        } else {
          setClickedRegion(r.region);
        }
      }
    }
    dragRef.current = null;
  };
  const onContextMenuCanvas = (e) => {
    e.preventDefault();
    const r = pickRegionAt(e.clientX, e.clientY);
    if (!r || !r.region) return;
    setContextMenu({ region: r.region, screenX: e.clientX, screenY: e.clientY });
  };

  // Wheel zoom: only when Ctrl is held. Otherwise the wheel scrolls the editor pane normally
  // — without this guard, hovering the map ate every wheel event and the user couldn't
  // scroll past it.
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const newZoom = Math.max(1, Math.min(8, zoom * factor));
    if (newZoom === zoom) return;
    const imgX = (cx - pan.x) / zoom;
    const imgY = (cy - pan.y) / zoom;
    setPan({ x: cx - imgX * newZoom, y: cy - imgY * newZoom });
    setZoom(newZoom);
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Search → pan & zoom to the first matching region.
  const onSearchSubmit = (q) => {
    if (!q || !pixels || !containerRef.current) return;
    const lc = q.toLowerCase();
    const region = (modIndex.regions || []).find(r => (r.region || "").toLowerCase().includes(lc));
    if (!region || !region.rgbKey) return;
    // Find the first pixel of that region in the buffer for a centroid.
    const targetKey = region.rgbKey;
    let cx = -1, cy = -1;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const k = `${pixels.data[i]},${pixels.data[i+1]},${pixels.data[i+2]}`;
      if (k === targetKey) { const idx = i / 4; cx = idx % pixels.width; cy = Math.floor(idx / pixels.width); break; }
    }
    if (cx < 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newZoom = Math.max(zoom, 3);
    const cssScaleX = (rect.width - 16) / pixels.width;
    const cssScaleY = (rect.height - 16) / pixels.height;
    const imgScreenX = cx * cssScaleX;
    const imgScreenY = cy * cssScaleY;
    setZoom(newZoom);
    setPan({ x: rect.width / 2 - imgScreenX * newZoom, y: rect.height / 2 - imgScreenY * newZoom });
    setHover({ region, x: rect.width / 2, y: rect.height / 2 });
    setClickedRegion(region);
    pushSearchHistory(q);
  };

  const exportPNG = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `region-map-${mode}-${unit ? unit.unit.replace(/\s+/g, "_") : "all"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  // For the click-to-side-panel: find every authored unit that can recruit in this region.
  const unitsInClickedRegion = useMemo(() => {
    if (!clickedRegion || !allUnits) return [];
    const out = [];
    for (const u of allUnits) {
      if (u.enabled === false) continue;
      const ks = computeMatchedKeys(u, modIndex.regions || [], modIndex.regionOwner || {});
      if (ks.has(clickedRegion.rgbKey)) out.push(u);
    }
    return out;
  }, [clickedRegion, allUnits, modIndex.regions, modIndex.regionOwner]);

  if (loading) return <div style={panelStyle}><div style={{ color: "#888", padding: 20 }}>Loading map…</div></div>;
  if (error) return <div style={panelStyle}><div style={{ color: "#a77", padding: 20 }}>Map unavailable: {error}</div></div>;

  const matchCount = mode === "compare" ? matched.size + matchedB.size : matched.size;
  const total = (modIndex.regions || []).filter(r => r.rgbKey).length;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
            Region map
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
            <option value="recruit">Recruitable (this unit)</option>
            <option value="faction">Faction colours</option>
            <option value="density">Density (all units)</option>
            <option value="compare">Compare two units</option>
            <option value="tier">Reachable by tier</option>
          </select>
          {mode === "compare" && (
            <select value={compareUnitId || ""} onChange={(e) => setCompareUnitId(e.target.value || null)} style={selectStyle}>
              <option value="">— pick comparison unit —</option>
              {(allUnits || []).filter(u => u.id !== (unit && unit.id)).slice(0, 500).map(u => (
                <option key={u.id} value={u.id}>{u.unit}</option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text" value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchSubmit(searchQ); }}
            placeholder="find region…"
            style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "3px 8px", borderRadius: 4, fontSize: 11, width: 130 }}
          />
          <button onClick={() => { const z = Math.max(1, zoom / 1.4); setZoom(z); if (z === 1) setPan({ x: 0, y: 0 }); }} style={zoomBtn} title="Zoom out (or Ctrl + scroll)">−</button>
          <span style={{ fontSize: 10, color: "#888", minWidth: 30, textAlign: "center", fontFamily: "Consolas, monospace" }} title="Ctrl + scroll to zoom">{zoom.toFixed(1)}×</span>
          <button onClick={() => setZoom(z => Math.min(8, z * 1.4))} style={zoomBtn} title="Zoom in (or Ctrl + scroll)">+</button>
          <button onClick={resetView} style={{ ...zoomBtn, fontSize: 10, padding: "2px 6px" }}>reset</button>
          <button onClick={exportPNG} style={{ ...zoomBtn, fontSize: 10, padding: "2px 8px" }} title="Save current view as PNG">PNG</button>
        </div>
      </div>
      <ModeLegend mode={mode} matchCount={matched.size} matchedBCount={matchedB.size} total={total} maxDensity={density.max} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: brushHR ? "rgba(124,201,153,0.06)" : "transparent" }}>
        <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>brush</span>
        <select value={brushHR} onChange={(e) => setBrushHR(e.target.value)} style={selectStyle}>
          <option value="">— off —</option>
          {(modIndex.hiddenResources || []).slice().sort((a, b) => a.id.localeCompare(b.id)).map(h => (
            <option key={h.id} value={h.id}>{h.id}</option>
          ))}
        </select>
        {brushHR && (
          <>
            <select value={brushMode} onChange={(e) => setBrushMode(e.target.value)} style={selectStyle}>
              <option value="toggle">toggle</option>
              <option value="add">add only</option>
              <option value="remove">remove only</option>
            </select>
            <span style={{ fontSize: 11, color: "#7c9", fontStyle: "italic" }}>{brushStatus || "Click a region to paint"}</span>
          </>
        )}
      </div>
      <div style={{ display: "flex" }}>
        <div
          ref={containerRef}
          onMouseLeave={() => { setHover(null); dragRef.current = null; }}
          onWheel={onWheel}
          style={{ position: "relative", padding: 8, overflow: "hidden", aspectRatio: pixels ? `${pixels.width} / ${pixels.height}` : "2 / 1", flex: 1 }}
        >
          <canvas
            ref={canvasRef}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onContextMenu={onContextMenuCanvas}
            style={{
              position: "absolute", left: 8, top: 8,
              width: `calc(100% - 16px)`, height: `calc(100% - 16px)`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0", imageRendering: "pixelated", display: "block",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
              cursor: dragRef.current ? "grabbing" : brushHR ? "cell" : (zoom > 1 ? "grab" : "crosshair"),
            }}
          />
          {hover && hover.region && (
            <div style={{
              position: "absolute", left: Math.min(hover.x + 10, 600), top: hover.y + 10,
              background: "rgba(20,22,23,0.96)",
              border: `1px solid ${matched.has(hover.region.rgbKey) ? "rgba(124,201,153,0.5)" : "rgba(232,136,136,0.4)"}`,
              borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "#ddd",
              pointerEvents: "none", zIndex: 100, maxWidth: 280, boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}>
              <div style={{ fontWeight: 700, color: matched.has(hover.region.rgbKey) ? "#7c9" : "#e88" }}>{hover.region.region}</div>
              <div style={{ color: "#888", fontSize: 11 }}>
                {hover.region.settlement} ·{" "}
                <span style={{ color: "#bca" }}>{(modIndex.regionOwner && modIndex.regionOwner[hover.region.region]) || hover.region.stratOwner || hover.region.owner}</span>
              </div>
              {mode === "density" && <div style={{ color: "#bca", fontSize: 11, marginTop: 3 }}>{density.byKey.get(hover.region.rgbKey) || 0} unit{(density.byKey.get(hover.region.rgbKey) || 0) === 1 ? "" : "s"} recruit here</div>}
              {hover.region.traits.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#bbb", fontFamily: "Consolas, monospace" }}>
                  {hover.region.traits.slice(0, 6).join(", ")}{hover.region.traits.length > 6 ? ` +${hover.region.traits.length - 6}` : ""}
                </div>
              )}
              <div style={{ marginTop: 4, fontSize: 10, color: "#666", fontStyle: "italic" }}>click for unit list · right-click for actions</div>
            </div>
          )}
        </div>
        {clickedRegion && (
          <div style={{ width: 240, padding: 10, borderLeft: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)", maxHeight: 480, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <strong style={{ color: "#dca64a" }}>{clickedRegion.region}</strong>
              <button onClick={() => setClickedRegion(null)} style={{ background: "transparent", border: "none", color: "#888", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              {clickedRegion.settlement} · {(modIndex.regionOwner && modIndex.regionOwner[clickedRegion.region]) || clickedRegion.stratOwner || clickedRegion.owner}
            </div>
            <div style={{ fontSize: 11, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>
              Recruits here ({unitsInClickedRegion.length})
            </div>
            {unitsInClickedRegion.length === 0 && <div style={{ color: "#888", fontStyle: "italic", fontSize: 12 }}>No authored unit recruits in this region.</div>}
            {unitsInClickedRegion.slice(0, 60).map(u => (
              <div
                key={u.id}
                onClick={() => onUnitClick && onUnitClick(u.id)}
                style={{ padding: "4px 6px", borderRadius: 3, fontSize: 11.5, color: "#ddd", cursor: onUnitClick ? "pointer" : "default", borderBottom: "1px dashed rgba(255,255,255,0.04)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.08)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                {u.unit}
                <span style={{ color: "#888", marginLeft: 6, fontSize: 10 }}>· t{u.canonicalMicTier ?? u.minTier ?? "?"} · {(u.factions || []).slice(0, 2).join(", ")}</span>
              </div>
            ))}
            {unitsInClickedRegion.length > 60 && <div style={{ color: "#888", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>+{unitsInClickedRegion.length - 60} more</div>}
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          region={contextMenu.region} x={contextMenu.screenX} y={contextMenu.screenY}
          onClose={() => setContextMenu(null)}
          onAddRequire={onAddRequire} onFilterFaction={onFilterFaction}
          owner={(modIndex.regionOwner && modIndex.regionOwner[contextMenu.region.region]) || contextMenu.region.stratOwner || contextMenu.region.owner}
        />
      )}
    </div>
  );
}

function ModeLegend({ mode, matchCount, matchedBCount, total, maxDensity }) {
  let body = null;
  if (mode === "recruit") {
    body = <span>{matchCount} / {total} regions match · <span style={{ color: "#7c9" }}>green = recruitable</span></span>;
  } else if (mode === "faction") {
    body = <span style={{ color: "#bca" }}>tinted by descr_strat owner faction</span>;
  } else if (mode === "density") {
    body = <span style={{ color: "#bca" }}>cool → hot scale (1 → {maxDensity || 0} units recruit)</span>;
  } else if (mode === "compare") {
    body = (
      <span>
        <span style={{ color: "#7c9" }}>● both</span> ·{" "}
        <span style={{ color: "#7af" }}>● A only ({matchCount})</span> ·{" "}
        <span style={{ color: "#e88" }}>● B only ({matchedBCount})</span>
      </span>
    );
  } else if (mode === "tier") {
    body = (
      <span>
        <span style={{ color: "#dca64a" }}>● tier 1</span> ·{" "}
        <span style={{ color: "#ccd" }}>● tier 2</span> ·{" "}
        <span style={{ color: "#c96" }}>● tier 3</span> ·{" "}
        <span style={{ color: "#a77" }}>● tier 4</span>
      </span>
    );
  }
  return (
    <div style={{ padding: "4px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "#999" }}>
      {body}
    </div>
  );
}

function ContextMenu({ region, x, y, onClose, onAddRequire, onFilterFaction, owner }) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, [onClose]);
  const items = (region.traits || []);
  return (
    <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: x, top: y, zIndex: 5000, background: "rgba(28,30,32,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6, padding: 6, fontSize: 12, color: "#ddd", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", minWidth: 240, maxHeight: 360, overflowY: "auto" }}>
      <div style={{ padding: "4px 8px", fontWeight: 700, color: "#dca64a", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 4 }}>
        {region.region}
        <span style={{ color: "#888", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{owner}</span>
      </div>
      {owner && onFilterFaction && (
        <div onClick={() => { onFilterFaction(owner); onClose(); }} style={menuItemStyle}>🎯 Filter unit list to <strong style={{ color: "#dca64a" }}>{owner}</strong></div>
      )}
      {items.length === 0 && <div style={{ padding: "4px 8px", color: "#666", fontStyle: "italic" }}>no traits / hidden_resources</div>}
      {items.map(t => (
        <div key={t} style={{ borderTop: "1px dashed rgba(255,255,255,0.06)", paddingTop: 2, marginTop: 2 }}>
          <div style={{ fontSize: 10, color: "#888", padding: "2px 8px", fontFamily: "Consolas, monospace" }}>{t}</div>
          <div onClick={() => { onAddRequire && onAddRequire("commonRequires", "hidden_resource", t); onClose(); }} style={menuItemStyle}>+ Add <code style={{ color: "#7c9" }}>hidden_resource {t}</code></div>
          <div onClick={() => { onAddRequire && onAddRequire("commonRequires", "not_hidden_resource", t); onClose(); }} style={menuItemStyle}>+ Add <code style={{ color: "#e88" }}>not hidden_resource {t}</code></div>
        </div>
      ))}
    </div>
  );
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const menuItemStyle = { padding: "5px 8px", cursor: "pointer", borderRadius: 4, transition: "background 0.1s" };
const zoomBtn = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#bbb", padding: "2px 8px", borderRadius: 3, fontSize: 14, cursor: "pointer", fontFamily: "Consolas, monospace", lineHeight: 1, minWidth: 22 };
const selectStyle = { background: "#252525", border: "1px solid #333", color: "#ddd", padding: "3px 7px", borderRadius: 4, fontSize: 11 };
const panelStyle = { marginTop: 14, background: "rgba(28,30,32,0.5)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 10, overflow: "hidden" };
