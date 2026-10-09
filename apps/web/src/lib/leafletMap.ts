import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/** Shared public OSM base layer for the places map and the viewer's location panel. */
export function addOsmTileLayer(map: L.Map): L.TileLayer {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map)
}
