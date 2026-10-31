import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FaLocationDot } from 'react-icons/fa6';
import type { Asset } from '@photox/shared-types';
import { SectionShell } from './SectionShell';

interface LocationSectionProps {
  asset: Asset;
}

function formatCoord(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value);
  return `${abs.toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

export const locationMarkerIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

export function LocationSection({ asset }: LocationSectionProps) {
  const lat = asset.latitude;
  const lng = asset.longitude;
  const altitude = asset.altitude;
  const hasCoords = lat != null && lng != null;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Create the map only when coordinates appear/disappear; the panel stays mounted across
  // prev/next navigation, so position updates live in the second effect.
  useEffect(() => {
    if (!hasCoords || !containerRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    map.invalidateSize();
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [hasCoords]);

  useEffect(() => {
    if (lat == null || lng == null || mapRef.current == null) return;
    const pos: L.LatLngExpression = [lat, lng];
    if (markerRef.current) {
      markerRef.current.setLatLng(pos);
    } else {
      markerRef.current = L.marker(pos, { icon: locationMarkerIcon }).addTo(mapRef.current);
    }
    mapRef.current.setView(pos, 14);
  }, [lat, lng]);

  if (!hasCoords) {
    return (
      <SectionShell compact title="Location">
        <p className="text-sm text-slate-600 italic">No location data</p>
      </SectionShell>
    );
  }

  const coordLat = formatCoord(lat, 'N', 'S');
  const coordLng = formatCoord(lng, 'E', 'W');
  const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`;

  return (
    <SectionShell title="Location">
      <div
        ref={containerRef}
        className="h-40 w-full rounded-lg border border-border-dark overflow-hidden mb-3"
      />
      <a
        href={mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-3 rounded-lg border border-border-dark hover:bg-card-dark transition-colors group"
      >
        <FaLocationDot className="text-primary text-xl shrink-0" />
        <div>
          <p className="text-xs text-slate-200 font-medium">
            {coordLat}, {coordLng}
          </p>
          <p className="text-[10px] text-slate-500 group-hover:text-primary transition-colors">
            Open in OpenStreetMap
          </p>
        </div>
      </a>
      {altitude != null && Number.isFinite(altitude) && (
        <p className="text-[10px] text-slate-500 tabular-nums mt-2">
          Altitude {parseFloat(altitude.toFixed(1))} m
        </p>
      )}
    </SectionShell>
  );
}
