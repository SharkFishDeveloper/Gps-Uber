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

// ---------- Leaflet marker icon fix for bundlers ----------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ---------- Helpers ----------
function RecenterOnce({ position }) {
  const map = useMap();
  const did = useRef(false);
  useEffect(() => {
    if (position && !did.current) {
      map.setView(position, 16);
      did.current = true;
    }
  }, [position, map]);
  return null;
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
  }, [bounds, map]);
  return null;
}

function TapToSet({ onSet, mode }) {
  // mode: "driver" | "dest" | null
  useMapEvents({
    click(e) {
      if (!mode) return;
      onSet([e.latlng.lat, e.latlng.lng], mode);
    },
  });
  return null;
}

// Straight-line (Haversine) km
function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isLatLng(v) {
  return Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

// ---------- Component ----------
export default function RideMapMultiLeg() {
  const [position, setPosition] = useState(null);   // USER [lat, lon] from GPS
  const [accuracy, setAccuracy] = useState(null);

  const [driver, setDriver] = useState(null);       // DRIVER [lat, lon] (tap to set)
  const [dest, setDest] = useState(null);           // DEST [lat, lon] (tap to set)

  // Route polylines
  const [routeDU, setRouteDU] = useState([]);       // Driver -> User
  const [routeUD, setRouteUD] = useState([]);       // User -> Destination

  // Distances/ETAs (per leg + total)
  const [kmDU, setKmDU] = useState(null);
  const [minDU, setMinDU] = useState(null);
  const [kmUD, setKmUD] = useState(null);
  const [minUD, setMinUD] = useState(null);

  const totalKm = useMemo(() => {
    const a = kmDU ? parseFloat(kmDU) : 0;
    const b = kmUD ? parseFloat(kmUD) : 0;
    const sum = a + b;
    return sum > 0 ? sum.toFixed(2) : null;
  }, [kmDU, kmUD]);
  const totalMin = useMemo(() => {
    const a = minDU || 0;
    const b = minUD || 0;
    const sum = a + b;
    return sum > 0 ? sum : null;
  }, [minDU, minUD]);

  const [loadingDU, setLoadingDU] = useState(false);
  const [loadingUD, setLoadingUD] = useState(false);
  const [error, setError] = useState("");

  // Which point are we setting with a tap?
  const [tapMode, setTapMode] = useState(null); // "driver" | "dest" | null

  // ---------- Live GPS ----------
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation not supported.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError("");
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setAccuracy(pos.coords.accuracy);
      },
      (err) => setError(err.message || "Unable to get location"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ---------- Straight-line fallbacks so UI never blank ----------
  useEffect(() => {
    // Driver -> User fallback
    if (isLatLng(driver) && isLatLng(position)) {
      const dKm = haversineKm(driver, position);
      setKmDU(dKm.toFixed(2));
      const eta = Math.max(1, Math.round((dKm / 25) * 60)); // 25 km/h city
      setMinDU(eta);
      setRouteDU([]);
    } else {
      setKmDU(null);
      setMinDU(null);
      setRouteDU([]);
    }
  }, [driver, position]);

  useEffect(() => {
    // User -> Destination fallback
    if (isLatLng(position) && isLatLng(dest)) {
      const dKm = haversineKm(position, dest);
      setKmUD(dKm.toFixed(2));
      const eta = Math.max(1, Math.round((dKm / 25) * 60));
      setMinUD(eta);
      setRouteUD([]);
    } else {
      setKmUD(null);
      setMinUD(null);
      setRouteUD([]);
    }
  }, [position, dest]);

  // ---------- Fetch routes from OSRM (two legs) ----------
  useEffect(() => {
    const fetchLeg = async (from, to, setCoords, setKm, setMin, setLoading) => {
      if (!isLatLng(from) || !isLatLng(to)) return;
      setLoading(true);
      try {
        const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
        const url =
          `https://router.project-osrm.org/route/v1/driving/${coords}` +
          `?overview=full&geometries=geojson&alternatives=false&steps=false&continue_straight=true`;
        const res = await fetch(url);
        if (!res.ok) {
          let msg = "";
          try {
            const j = await res.json();
            msg = j?.message || j?.code || "";
          } catch {
            msg = await res.text().catch(() => "");
          }
          throw new Error(`OSRM ${res.status}${msg ? `: ${msg}` : ""}`);
        }
        const data = await res.json();
        const r = data.routes?.[0];
        if (!r) throw new Error("No route found");
        const path = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        setCoords(path);
        setKm((r.distance / 1000).toFixed(2));
        setMin(Math.max(1, Math.round(r.duration / 60)));
      } catch (e) {
        setError((e?.message || "Route fetch failed") + " — showing straight-line estimate.");
        // keep existing fallback numbers & empty polyline
      } finally {
        setLoading(false);
      }
    };

    // Debounce tiny GPS jitters
    const t1 = setTimeout(() => fetchLeg(driver, position, setRouteDU, setKmDU, setMinDU, setLoadingDU), 300);
    const t2 = setTimeout(() => fetchLeg(position, dest, setRouteUD, setKmUD, setMinUD, setLoadingUD), 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [driver, position, dest]);

  // ---------- Map bounds ----------
  const bounds = useMemo(() => {
    const pts = [];
    if (routeDU.length) pts.push(...routeDU);
    if (routeUD.length) pts.push(...routeUD);
    if (!pts.length) {
      if (isLatLng(driver)) pts.push(driver);
      if (isLatLng(position)) pts.push(position);
      if (isLatLng(dest)) pts.push(dest);
    }
    return pts.length ? L.latLngBounds(pts) : null;
  }, [routeDU, routeUD, driver, position, dest]);

  // ---------- Guards ----------
  if (!position) {
  return (
    <div style={{ padding: 12, fontFamily: "system-ui" }}>
      {error ? `Error: ${error}` : "Allow location access to see the map…"}
    </div>
  );
}

  // ---------- Render ----------
  return (
    <div
      style={{
        height: "100svh",
        width: "100%",
        position: "relative",
        background: "#f4f4f4",
      }}
    >
      <MapContainer center={position} zoom={16} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        <RecenterOnce position={position} />
        <FitBounds bounds={bounds} />
        <TapToSet
          mode={tapMode}
          onSet={(latlng, which) => {
            if (which === "driver") setDriver(latlng);
            if (which === "dest") setDest(latlng);
            setTapMode(null);
          }}
        />

        {/* User (you) */}
        <Marker position={position}>
          <Popup>
            User (You)
            <br />
            Accuracy: {accuracy ? Math.round(accuracy) : "—"} m
          </Popup>
        </Marker>
        {accuracy && <Circle center={position} radius={accuracy} />}

        {/* Driver */}
        {isLatLng(driver) && (
          <Marker position={driver}>
            <Popup>Driver</Popup>
          </Marker>
        )}

        {/* Destination */}
        {isLatLng(dest) && (
          <Marker position={dest}>
            <Popup>Destination</Popup>
          </Marker>
        )}

        {/* Routes */}
        {routeDU.length > 0 && (
          <Polyline positions={routeDU} weight={6} color="#1e90ff" /> // driver→user
        )}
        {routeUD.length > 0 && (
          <Polyline positions={routeUD} weight={6} color="#34d399" /> // user→dest
        )}
      </MapContainer>

      {/* Controls */}
      <div
        style={{
          position: "fixed",
          top: 10,
          right: 10,
          display: "flex",
          gap: 8,
          zIndex: 10000,
        }}
      >
        <button
          onClick={() => setTapMode(tapMode === "driver" ? null : "driver")}
          style={{
            border: "1px solid #ddd",
            background: tapMode === "driver" ? "#dbeafe" : "#fff",
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {tapMode === "driver" ? "Tap map: set Driver" : "Set Driver"}
        </button>
        <button
          onClick={() => setTapMode(tapMode === "dest" ? null : "dest")}
          style={{
            border: "1px solid #ddd",
            background: tapMode === "dest" ? "#dcfce7" : "#fff",
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {tapMode === "dest" ? "Tap map: set Destination" : "Set Destination"}
        </button>
      </div>

      {/* Bottom info bar */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "12px 16px",
          paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          background: "#fff",
          borderTop: "1px solid #e8e8e8",
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 12,
          alignItems: "center",
          zIndex: 9999,
          fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        }}
      >
        <div style={{ fontSize: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Driver → You</div>
          <div>
            {kmDU ? `${kmDU} km` : "—"} · {minDU ? `${minDU} min` : "—"}
          </div>
        </div>

        <div style={{ fontSize: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>You → Destination</div>
          <div>
            {kmUD ? `${kmUD} km` : "—"} · {minUD ? `${minUD} min` : "—"}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {totalKm ? `${totalKm} km` : "—"} · {totalMin ? `${totalMin} min` : "—"}
          </div>
        </div>

        <button
          onClick={() => {
            setDriver(null);
            setDest(null);
            setRouteDU([]);
            setRouteUD([]);
            setKmDU(null);
            setKmUD(null);
            setMinDU(null);
            setMinUD(null);
            setError("");
          }}
          style={{
            gridColumn: "1 / -1",
            border: "1px solid #ddd",
            background: "#fafafa",
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
            marginTop: 6,
          }}
        >
          Clear
        </button>
      </div>

      {/* Status pill */}
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          background: "rgba(255,255,255,0.95)",
          padding: "6px 10px",
          borderRadius: 8,
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontFamily: "system-ui",
          fontSize: 12,
          zIndex: 9999,
          maxWidth: 320,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <div><b>Status:</b> {loadingDU || loadingUD ? "Fetching routes…" : "Idle"}</div>
        {error && <div style={{ color: "#c00" }}>{error}</div>}
      </div>
    </div>
  );
}
