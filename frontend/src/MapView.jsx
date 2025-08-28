import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, Marker, Popup, Circle, Polyline,
  useMap, useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ---- Leaflet icon fix ----
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ---- Helpers ----
function RecenterOnce({ position }) {
  const map = useMap(); const did = useRef(false);
  useEffect(() => { if (position && !did.current) { map.setView(position, 16); did.current = true; }}, [position, map]);
  return null;
}
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [40, 40] }); }, [bounds, map]);
  return null;
}
function TapHandler({ onSetDest, onAddVia }) {
  useMapEvents({
    click(e) {
      if (e.originalEvent.shiftKey) onAddVia([e.latlng.lat, e.latlng.lng]); // Shift+click adds VIA
      else onSetDest([e.latlng.lat, e.latlng.lng]); // normal click sets Destination
    },
  });
  return null;
}
function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371, dLat = ((lat2-lat1)*Math.PI)/180, dLon = ((lon2-lon1)*Math.PI)/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const isLatLng = (v) => Array.isArray(v) && v.length === 2 && isFinite(v[0]) && isFinite(v[1]);

export default function RideMapWithVias() {
  const [position, setPosition] = useState(null); // user (you)
  const [accuracy, setAccuracy] = useState(null);
  const [dest, setDest] = useState(null);
  const [vias, setVias] = useState([]); // array of [lat, lon]

  const [routeCoords, setRouteCoords] = useState([]);
  const [distanceKm, setDistanceKm] = useState(null);
  const [durationMin, setDurationMin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Avoid toggles
  const [avoidMotorway, setAvoidMotorway] = useState(false);
  const [avoidFerry, setAvoidFerry] = useState(false);
  const [avoidToll, setAvoidToll] = useState(false); // may be ignored if profile lacks toll data

  // Live GPS
  useEffect(() => {
    if (!("geolocation" in navigator)) { setError("Geolocation not supported."); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => { setError(""); setPosition([pos.coords.latitude, pos.coords.longitude]); setAccuracy(pos.coords.accuracy); },
      (err) => setError(err.message || "Unable to get location"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Instant fallback (straight-line) so UI isn't blank
  useEffect(() => {
    if (!isLatLng(position) || !isLatLng(dest)) return;
    // straight line from user -> first via -> ... -> dest
    const pts = [position, ...vias, dest];
    let km = 0;
    for (let i = 0; i < pts.length - 1; i++) km += haversineKm(pts[i], pts[i+1]);
    setDistanceKm(km.toFixed(2));
    const eta = Math.max(1, Math.round((km / 25) * 60)); // 25 km/h city
    setDurationMin(eta);
    setRouteCoords([]); // clear until OSRM arrives
  }, [position, dest, vias]);

  // Build OSRM URL for user -> via1 -> via2 -> ... -> dest
  function buildRouteUrl() {
    const all = [position, ...vias, dest];
    if (!all.every(isLatLng)) return null;
    const coordsStr = all.map(([lat, lon]) => `${lon},${lat}`).join(";");
    const exclude = [avoidMotorway && "motorway", avoidFerry && "ferry", avoidToll && "toll"]
      .filter(Boolean).join(",");
    return (
      `https://router.project-osrm.org/route/v1/driving/${coordsStr}` +
      `?overview=full&geometries=geojson&steps=false&alternatives=false&continue_straight=true` +
      (exclude ? `&exclude=${encodeURIComponent(exclude)}` : ``)
    );
  }

  // Fetch OSRM
  useEffect(() => {
    if (!isLatLng(position) || !isLatLng(dest)) return;
    const url = buildRouteUrl();
    if (!url) return;

    let canceled = false;
    setLoading(true); setError("");

    const t = setTimeout(async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          let msg = "";
          try { const j = await res.json(); msg = j?.message || j?.code || ""; } catch {}
          throw new Error(`OSRM ${res.status}${msg ? `: ${msg}` : ""}`);
        }
        const data = await res.json();
        const r = data.routes?.[0];
        if (!r) throw new Error("No route found");
        if (canceled) return;
        const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        setRouteCoords(coords);
        setDistanceKm((r.distance / 1000).toFixed(2));
        setDurationMin(Math.max(1, Math.round(r.duration / 60)));
      } catch (e) {
        if (!canceled) setError((e?.message || "Route fetch failed") + " — showing straight-line.");
      } finally {
        if (!canceled) setLoading(false);
      }
    }, 300);

    return () => { clearTimeout(t); canceled = true; };
  }, [position, dest, vias, avoidMotorway, avoidFerry, avoidToll]);

  // Bounds
  const bounds = useMemo(() => {
    const pts = [];
    if (routeCoords.length) pts.push(...routeCoords);
    else {
      if (isLatLng(position)) pts.push(position);
      vias.forEach(v => isLatLng(v) && pts.push(v));
      if (isLatLng(dest)) pts.push(dest);
    }
    return pts.length ? L.latLngBounds(pts) : null;
  }, [routeCoords, position, dest, vias]);

  if (!position) {
    return <div style={{ padding: 12, fontFamily: "system-ui" }}>Allow location access…</div>;
  }

  return (
    <div style={{ height: "100svh", width: "100%", position: "relative", background: "#f4f4f4" }}>
      <MapContainer center={position} zoom={16} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
        <RecenterOnce position={position} />
        <FitBounds bounds={bounds} />
        <TapHandler
          onSetDest={setDest}
          onAddVia={(pt) => setVias(v => [...v, pt])}
        />

        {/* User */}
        <Marker position={position}>
          <Popup>
            User (You)<br />Accuracy: {accuracy ? Math.round(accuracy) : "—"} m
          </Popup>
        </Marker>
        {accuracy && <Circle center={position} radius={accuracy} />}

        {/* Vias (numbered) */}
        {vias.map((v, i) => (
          <Marker key={i} position={v} draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = e.target.getLatLng();
                setVias(prev => prev.map((p, idx) => idx === i ? [ll.lat, ll.lng] : p));
              }
            }}>
            <Popup>Via #{i+1} (drag to adjust)</Popup>
          </Marker>
        ))}

        {/* Destination */}
        {isLatLng(dest) && (
          <Marker position={dest}>
            <Popup>Destination</Popup>
          </Marker>
        )}

        {/* Route */}
        {routeCoords.length > 0 && <Polyline positions={routeCoords} weight={6} />}
      </MapContainer>

      {/* Controls */}
      <div style={{ position: "fixed", top: 10, right: 10, zIndex: 10000, display: "grid", gap: 8 }}>
        <div style={{ padding: 8, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Tap map</div>
          <div>• Click = set <b>Destination</b></div>
          <div>• <b>Shift+Click</b> = add <b>Via</b></div>
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={avoidMotorway} onChange={e=>setAvoidMotorway(e.target.checked)} />
              Avoid motorway
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={avoidFerry} onChange={e=>setAvoidFerry(e.target.checked)} />
              Avoid ferry
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={avoidToll} onChange={e=>setAvoidToll(e.target.checked)} />
              Avoid toll (may not always apply)
            </label>
          </div>
          <button
            onClick={() => setVias([])}
            style={{ marginTop: 8, width: "100%", border: "1px solid #e5e7eb", background: "#fafafa", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}>
            Clear vias
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        background: "#fff", borderTop: "1px solid #e8e8e8",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        zIndex: 9999, fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      }}>
        {!dest ? (
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            Click to set destination · Shift+Click to add via
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Distance: {distanceKm ?? "—"} km</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>ETA: {durationMin ?? "—"} min</div>
            <button
              onClick={() => {
                setDest(null); setVias([]); setRouteCoords([]);
                setDistanceKm(null); setDurationMin(null); setError("");
              }}
              style={{ border: "1px solid #ddd", background: "#fafafa", borderRadius: 10, padding: "8px 12px", fontWeight: 600, cursor: "pointer" }}>
              Clear
            </button>
          </>
        )}
      </div>

      {/* Status pill */}
      <div style={{
        position: "fixed", top: 10, left: 10, background: "rgba(255,255,255,0.95)",
        padding: "6px 10px", borderRadius: 8, boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
        fontFamily: "system-ui", fontSize: 12, zIndex: 9999, maxWidth: 320,
      }}>
        <div><b>Status:</b> {loading ? "Fetching route…" : "Idle"}</div>
        {error && <div style={{ color: "#c00" }}>{error}</div>}
      </div>
    </div>
  );
}
