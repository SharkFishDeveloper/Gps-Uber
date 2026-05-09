import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

/* ---------- Leaflet marker fix ---------- */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

/* ---------- Custom Icons ---------- */
const makeIcon = (color, label) =>
  L.divIcon({
    className: "",
    html: `<div style="
      width:36px;height:36px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);
      border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
    ">
      <span style="transform:rotate(45deg);font-size:14px;color:#fff;font-weight:800;line-height:1;">${label}</span>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40],
  });

const userIcon = makeIcon("#6366f1", "◉");
const driverIcon = makeIcon("#f59e0b", "D");
const destIcon = makeIcon("#10b981", "▶");

/* ---------- Map Styles ---------- */
const MAP_STYLES = {
  light: {
    name: "Light",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },

  dark: {
    name: "Dark",
    url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=YOUR_KEY",
    attribution:
      "© Stadia Maps © OpenMapTiles © OpenStreetMap contributors",
  },

  normal: {
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },

  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
  },

  topo: {
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenTopoMap contributors",
  },
};
/* ---------- Helpers ---------- */
function roundGPS([lat, lon]) {
  return [Number(lat.toFixed(5)), Number(lon.toFixed(5))];
}
function isLatLng(v) {
  return Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}
function decodePolyline(str, precision = 6) {
  let index = 0, lat = 0, lng = 0;
  const coordinates = [], factor = Math.pow(10, precision);
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

/* ---------- Map sub-components ---------- */
function RecenterOnce({ position }) {
  const map = useMap();
  const did = useRef(false);
  useEffect(() => { if (position && !did.current) { map.setView(position, 16); did.current = true; } }, [position, map]);
  return null;
}

function ViewportController({ bounds, follow, onUserPan }) {
  const map = useMap();
  const ref = useRef(false);
  useMapEvents({
    dragstart() { ref.current = true; onUserPan(); },
    zoomstart() { ref.current = true; onUserPan(); },
    moveend() { setTimeout(() => { ref.current = false; }, 0); },
  });
  useEffect(() => {
    if (!bounds || !follow || ref.current) return;
    map.fitBounds(bounds, { padding: [60, 60] });
  }, [bounds, follow, map]);
  return null;
}

function TapToSet({ onSet, mode }) {
  const movedRef = useRef(false);
  useMapEvents({
    dragstart() { movedRef.current = true; },
    zoomstart() { movedRef.current = true; },
    moveend() { movedRef.current = false; },
    click(e) { if (!mode || movedRef.current) return; onSet([e.latlng.lat, e.latlng.lng], mode); },
  });
  return null;
}

/* ---------- Styles ---------- */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; }

  .ride-root {
    font-family: 'DM Sans', sans-serif;
    height: 100svh;
    width: 100%;
    position: relative;
    overflow: hidden;
    --indigo: #6366f1;
    --amber: #f59e0b;
    --emerald: #10b981;
    --glass: rgba(255,255,255,0.92);
    --glass-border: rgba(255,255,255,0.6);
    --shadow: 0 8px 32px rgba(0,0,0,0.14);
    --shadow-sm: 0 2px 12px rgba(0,0,0,0.1);
    --radius: 18px;
    --radius-sm: 12px;
  }

  /* ---- Top bar ---- */
  .top-bar {
    position: fixed;
    top: 12px;
    left: 12px;
    right: 12px;
    z-index: 10000;
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  /* ---- Search panels ---- */
  .search-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .search-card {
    background: var(--glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    transition: box-shadow 0.2s;
    position: relative;
  }

  .search-card:focus-within {
    box-shadow: 0 8px 32px rgba(99,102,241,0.22);
    border-color: var(--indigo);
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
  }

  .search-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .search-input {
    border: none;
    background: transparent;
    font-family: 'DM Sans', sans-serif;
    font-size: 13.5px;
    font-weight: 500;
    color: #1e1b4b;
    padding: 12px 0;
    width: 100%;
    outline: none;
  }

  .search-input::placeholder { color: #9ca3af; font-weight: 400; }

  .search-results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 32px rgba(0,0,0,0.14);
    max-height: 200px;
    overflow-y: auto;
    z-index: 20000;
  }

  .search-result-item {
    padding: 10px 14px;
    font-size: 12.5px;
    color: #374151;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid #f3f4f6;
    line-height: 1.4;
    font-weight: 400;
  }

  .search-result-item:hover { background: #f0f4ff; color: #1e1b4b; }
  .search-result-item:last-child { border-bottom: none; }

  /* ---- Right controls ---- */
  .right-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .map-style-select {
    background: var(--glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    padding: 10px 12px;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #1e1b4b;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    text-align: center;
    min-width: 90px;
  }

  .icon-btn {
    background: var(--glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    padding: 10px 12px;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    color: #374151;
    outline: none;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .icon-btn:hover { background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.18); }
  .icon-btn.active-driver { background: #fef3c7; border-color: var(--amber); color: #92400e; }
  .icon-btn.active-dest { background: #d1fae5; border-color: var(--emerald); color: #065f46; }

  /* ---- Bottom sheet ---- */
  .bottom-sheet {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: var(--glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--glass-border);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -4px 40px rgba(0,0,0,0.12);
    padding: 20px 20px 24px;
    z-index: 10000;
  }

  .sheet-handle {
    width: 40px; height: 4px;
    background: #d1d5db;
    border-radius: 2px;
    margin: 0 auto 18px;
  }

  .sheet-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }

  .leg-card {
    background: #fff;
    border-radius: 14px;
    padding: 12px 14px;
    border: 1.5px solid #f1f5f9;
  }

  .leg-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .leg-dot { width: 8px; height: 8px; border-radius: 50%; }

  .leg-value {
    font-size: 16px;
    font-weight: 800;
    color: #111827;
    font-family: 'DM Mono', monospace;
    letter-spacing: -0.02em;
  }

  .leg-sub {
    font-size: 11px;
    color: #6b7280;
    font-weight: 500;
    margin-top: 2px;
  }

  .total-row {
    background: #1e1b4b;
    border-radius: 14px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .total-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.55);
  }

  .total-value {
  font-family: 'DM Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  letter-spacing: -0.01em;
  text-align: right;
  line-height: 1.35;
}

  /* ---- Status pill ---- */
  .status-pill {
    position: fixed;
    bottom: 200px;
    left: 50%;
    transform: translateX(-50%);
    background: #1e1b4b;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 16px;
    border-radius: 99px;
    z-index: 10001;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 7px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    animation: fadeIn 0.2s ease;
  }

  .spinner {
    width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

  .error-pill {
    position: fixed;
    bottom: 200px;
    left: 50%;
    transform: translateX(-50%);
    background: #dc2626;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 16px;
    border-radius: 99px;
    z-index: 10001;
    pointer-events: none;
    box-shadow: 0 4px 20px rgba(220,38,38,0.35);
  }

  /* ---- Tap cursor ---- */
  .ride-root.tap-mode { cursor: crosshair; }

  /* ---- Leaflet overrides ---- */
  .leaflet-control-attribution { font-size: 9px !important; }
  .leaflet-control-zoom { border-radius: 12px !important; overflow: hidden; border: none !important; box-shadow: var(--shadow) !important; }
  .leaflet-control-zoom a { font-size: 16px !important; width: 34px !important; height: 34px !important; line-height: 34px !important; color: #374151 !important; }
`;

/* ---------- Component ---------- */
export default function RideMapMultiLeg() {
  const [mapStyle, setMapStyle] = useState("light");
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [driver, setDriver] = useState(null);
  const [dest, setDest] = useState(null);
  const [routeDU, setRouteDU] = useState([]);
  const [routeUD, setRouteUD] = useState([]);
  const [kmDU, setKmDU] = useState(null);
  const [minDU, setMinDU] = useState(null);
  const [kmUD, setKmUD] = useState(null);
  const [minUD, setMinUD] = useState(null);
  const [loadingDU, setLoadingDU] = useState(false);
  const [loadingUD, setLoadingUD] = useState(false);
  const [error, setError] = useState("");
  const [tapMode, setTapMode] = useState(null);
  const [follow, setFollow] = useState(true);
  const mapRef = useRef(null);

  const [driverQuery, setDriverQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [driverResults, setDriverResults] = useState([]);
  const [destResults, setDestResults] = useState([]);

  const totalKm = useMemo(() => {
    const a = kmDU ? parseFloat(kmDU) : 0;
    const b = kmUD ? parseFloat(kmUD) : 0;
    const sum = a + b;
    return sum > 0 ? sum.toFixed(2) : null;
  }, [kmDU, kmUD]);

  const totalMin = useMemo(() => {
    const sum = (minDU || 0) + (minUD || 0);
    return sum > 0 ? sum : null;
  }, [minDU, minUD]);

  let searchTimeout;


async function searchPlace(query, type) {
  clearTimeout(searchTimeout);

  if (!query.trim()) {
    if (type === "driver") {
      setDriverResults([]);
    } else {
      setDestResults([]);
    }

    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const url =
        `https://corsproxy.io/?${encodeURIComponent(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${query}&limit=6&addressdetails=1`
        )}`;

      const res = await fetch(url);

      const data = await res.json();

      if (type === "driver") {
        setDriverResults(data || []);
      } else {
        setDestResults(data || []);
      }
    } catch (e) {
      console.log(e);
    }
  }, 350);
}

  useEffect(() => {
    if (!("geolocation" in navigator)) { setError("Geolocation not supported."); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError("");
        setPosition(roundGPS([pos.coords.latitude, pos.coords.longitude]));
        setAccuracy(pos.coords.accuracy);
      },
      (err) => setError(err.message || "Unable to get location"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    const fetchLeg = async (leg, from, to) => {
      if (!isLatLng(from) || !isLatLng(to)) return;
      leg === "DU" ? setLoadingDU(true) : setLoadingUD(true);
      try {
        const res = await fetch("https://valhalla1.openstreetmap.de/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: [{ lat: from[0], lon: from[1] }, { lat: to[0], lon: to[1] }], costing: "auto", shape_format: "polyline6" }),
        });
        const data = await res.json();
        const trip = data.trip;
        if (!trip) throw new Error("No route found");
        const path = decodePolyline(trip.legs?.[0]?.shape);
        const summary = trip.summary;
        const km = Number(summary.length).toFixed(2);
        const min = Math.max(1, Math.round(summary.time / 60));
        if (leg === "DU") { setRouteDU(path); setKmDU(km); setMinDU(min); }
        else { setRouteUD(path); setKmUD(km); setMinUD(min); }
      } catch (e) { console.log(e); setError("Routing failed"); }
      finally { leg === "DU" ? setLoadingDU(false) : setLoadingUD(false); }
    };
    fetchLeg("DU", driver, position);
    fetchLeg("UD", position, dest);
  }, [driver, position, dest]);

  const bounds = useMemo(() => {
    const pts = [...(routeDU.length ? routeDU : []), ...(routeUD.length ? routeUD : [])];
    return pts.length ? L.latLngBounds(pts) : null;
  }, [routeDU, routeUD]);

  function goToMyLocation() {
    if (!position) return;
    mapRef.current?.flyTo(position, 16);
    setFollow(true);
  }

  if (!position) {
    return (
      <div style={{ height: "100svh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif", gap: 12 }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e0e7ff", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: "#6366f1" }}>Acquiring GPS…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const isLoading = loadingDU || loadingUD;

  return (
    <div className={`ride-root${tapMode ? " tap-mode" : ""}`}>
      <style>{css}</style>

      {/* Map */}
      <MapContainer
        center={position}
        zoom={16}
        style={{ height: "100%", width: "100%" }}
        whenCreated={(m) => (mapRef.current = m)}
        zoomControl={true}
      >
        <TileLayer key={mapStyle} url={MAP_STYLES[mapStyle].url} attribution={MAP_STYLES[mapStyle].attribution} />
        <RecenterOnce position={position} />
        <ViewportController bounds={bounds} follow={follow} onUserPan={() => setFollow(false)} />
        <TapToSet mode={tapMode} onSet={(latlng, which) => { which === "driver" ? setDriver(latlng) : setDest(latlng); setTapMode(null); }} />

        <Marker position={position} icon={userIcon}>
          <Popup><b>Your Location</b><br />Accuracy: {accuracy ? Math.round(accuracy) : "—"} m</Popup>
        </Marker>
        {accuracy && <Circle center={position} radius={accuracy} pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.08, weight: 1.5 }} />}
        {driver && <Marker position={driver} icon={driverIcon}><Popup><b>Driver</b></Popup></Marker>}
        {dest && <Marker position={dest} icon={destIcon}><Popup><b>Destination</b></Popup></Marker>}
        {routeDU.length > 0 && <Polyline positions={routeDU} pathOptions={{ color: "#f59e0b", weight: 5, opacity: 0.9, dashArray: "0", lineCap: "round", lineJoin: "round" }} />}
        {routeUD.length > 0 && <Polyline positions={routeUD} pathOptions={{ color: "#10b981", weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round" }} />}
      </MapContainer>

      {/* Top Bar */}
      <div className="top-bar">
        <div className="search-panel">
          {/* Driver Search */}
          <div className="search-card">
            <div className="search-input-row">
              <div className="search-dot" style={{ background: "#f59e0b" }} />
              <input
                className="search-input"
                value={driverQuery}
                onChange={(e) => { setDriverQuery(e.target.value); searchPlace(e.target.value, "driver"); }}
                placeholder="Driver's location…"
              />
            </div>
            {driverResults.length > 0 && (
              <div className="search-results">
                {driverResults.map((r) => (
                  <div key={r.place_id} className="search-result-item"
                    onClick={() => {
                      const p = [parseFloat(r.lat), parseFloat(r.lon)];
                      setDriver(p); setDriverQuery(r.display_name); setDriverResults([]);
                      mapRef.current?.flyTo(p, 15);
                    }}>
                    {r.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination Search */}
          <div className="search-card">
            <div className="search-input-row">
              <div className="search-dot" style={{ background: "#10b981" }} />
              <input
                className="search-input"
                value={destQuery}
                onChange={(e) => { setDestQuery(e.target.value); searchPlace(e.target.value, "dest"); }}
                placeholder="Where to?"
              />
            </div>
            {destResults.length > 0 && (
              <div className="search-results">
                {destResults.map((r) => (
                  <div key={r.place_id} className="search-result-item"
                    onClick={() => {
                      const p = [parseFloat(r.lat), parseFloat(r.lon)];
                      setDest(p); setDestQuery(r.display_name); setDestResults([]);
                      mapRef.current?.flyTo(p, 15);
                    }}>
                    {r.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right controls */}
        <div className="right-controls">
          <select className="map-style-select" value={mapStyle} onChange={(e) => setMapStyle(e.target.value)}>
            {Object.entries(MAP_STYLES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <button className="icon-btn" onClick={goToMyLocation}>⊕ Me</button>
          <button
            className={`icon-btn${tapMode === "driver" ? " active-driver" : ""}`}
            onClick={() => setTapMode(tapMode === "driver" ? null : "driver")}>
            {tapMode === "driver" ? "Tap map" : "📍 Driver"}
          </button>
          <button
            className={`icon-btn${tapMode === "dest" ? " active-dest" : ""}`}
            onClick={() => setTapMode(tapMode === "dest" ? null : "dest")}>
            {tapMode === "dest" ? "Tap map" : "🏁 Dest"}
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="status-pill">
          <div className="spinner" />
          Fetching routes…
        </div>
      )}
      {!isLoading && error && <div className="error-pill">⚠ {error}</div>}

      {/* Bottom Sheet */}
      <div className="bottom-sheet">
        <div className="sheet-handle" />
        <div className="sheet-grid">
          <div className="leg-card">
            <div className="leg-label">
              <div className="leg-dot" style={{ background: "#f59e0b" }} />
              Driver → You
            </div>
            {kmDU ? (
              <>
                <div className="leg-value">{kmDU} km</div>
                <div className="leg-sub">{minDU} min</div>
              </>
            ) : (
              <div className="leg-value" style={{ color: "#d1d5db" }}>—</div>
            )}
          </div>
          <div className="leg-card">
            <div className="leg-label">
              <div className="leg-dot" style={{ background: "#10b981" }} />
              You → Dest
            </div>
            {kmUD ? (
              <>
                <div className="leg-value">{kmUD} km</div>
                <div className="leg-sub">{minUD} min</div>
              </>
            ) : (
              <div className="leg-value" style={{ color: "#d1d5db" }}>—</div>
            )}
          </div>
        </div>
        <div className="total-row">
          <div className="total-label">Total Journey</div>
          <div className="total-value">
            {totalKm ? `${totalKm} km · ${totalMin} min` : "Set locations above"}
          </div>
        </div>
      </div>
    </div>
  );
}