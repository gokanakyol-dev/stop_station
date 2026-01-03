import { runStep1Pipeline } from '../pipeline/index.js';

// DOM Elements
const csvFile = document.getElementById('csvFile');
const stopsFile = document.getElementById('stopsFile');
const directionFilter = document.getElementById('directionFilter');
const btnPipeline = document.getElementById('btnPipeline');
const btnClear = document.getElementById('btnClear');
const output = document.getElementById('output');

// State
let gpsRecords = [];
let stops = [];

// Map Setup
const map = L.map('map').setView([41.0, 28.9], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);

const layers = {
  route: L.layerGroup().addTo(map),
  stops: L.layerGroup().addTo(map)
};

// Utilities
function log(msg) {
  output.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
}

function showLoading(btn, show) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.loader');
  if (show) {
    text.style.display = 'none';
    loader.style.display = 'inline';
    btn.disabled = true;
  } else {
    text.style.display = 'inline';
    loader.style.display = 'none';
    btn.disabled = false;
  }
}

function parseTurkishDate(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeGpsRow(row) {
  const lat = Number(String(row.Enlem || row.enlem || row.lat || '').replace(',', '.'));
  const lon = Number(String(row.Boylam || row.boylam || row.lon || '').replace(',', '.'));
  const timestamp = parseTurkishDate(row.KonumZamani || row.KonumZamanı || row.timestamp);
  
  return {
    seferId: row.SeferId || row.seferId || null,
    lineId: row.lineId || row.LineId || null,
    routeId: row.routeId || row.RouteId || null,
    vehicleId: row.Plaka || row.plaka || row.vehicleId || null,
    lat, lon, timestamp,
    speed: Number(row.Hiz || row.hiz || row.speed || 0)
  };
}

function displayStops() {
  layers.stops.clearLayers();
  const filter = directionFilter.value;
  
  const filtered = stops.filter(s => {
    if (filter === 'all') return true;
    const dir = (s.direction || s.yon || '').toLowerCase();
    if (filter === 'gidis') return dir.includes('gidis') || dir.includes('gıdis') || dir === '0';
    if (filter === 'donus') return dir.includes('donus') || dir.includes('dönus') || dir === '1';
    return true;
  });
  
  console.log(`Displaying ${filtered.length} stops (filter: ${filter})`);
  
  for (const s of filtered) {
    const dir = (s.direction || s.yon || '').toLowerCase();
    let color = '#dc2626'; // default red
    
    if (dir.includes('gidis') || dir.includes('gıdis') || dir === '0') {
      color = '#10b981'; // green for gidis
    } else if (dir.includes('donus') || dir.includes('dönus') || dir === '1') {
      color = '#ef4444'; // red for donus
    }
    
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 8,
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 0.9,
      weight: 2
    });
    
    const popupText = `<b>${s.name || s.id || 'Durak'}</b><br>Yön: ${s.direction || s.yon || 'bilinmiyor'}`;
    marker.bindPopup(popupText);
    marker.addTo(layers.stops);
  }
  
  console.log(`${filtered.length} durak haritaya eklendi`);
}

// CSV Loading
csvFile.addEventListener('change', async () => {
  try {
    const file = csvFile.files[0];
    if (!file) return;
    
    log('📂 CSV okunuyor...');
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    
    if (parsed.errors?.length) {
      log({ error: 'CSV parse hatası', errors: parsed.errors.slice(0, 3) });
      return;
    }
    
    gpsRecords = parsed.data
      .map(normalizeGpsRow)
      .filter(r => 
        Number.isFinite(r.lat) && Number.isFinite(r.lon) &&
        r.lat >= -90 && r.lat <= 90 && r.lon >= -180 && r.lon <= 180 &&
        r.timestamp instanceof Date && !isNaN(r.timestamp.getTime())
      );
    
    btnPipeline.disabled = gpsRecords.length === 0;
    log({ status: 'ok', records: gpsRecords.length, sample: gpsRecords[0] });
    
  } catch (err) {
    log({ error: err.message });
    console.error(err);
  }
});

// Stops Loading
stopsFile.addEventListener('change', async () => {
  try {
    const file = stopsFile.files[0];
    if (!file) return;
    
    log('📍 Durak JSON okunuyor...');
    const text = await file.text();
    const json = JSON.parse(text);
    
    // GeoJSON Feature Collection mı?
    let arr = [];
    if (json.type === 'FeatureCollection' && json.features) {
      arr = json.features.map(f => {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates || [];
        
        // EPSG:3857 (Web Mercator) -> WGS84 (lat/lon)
        let lat, lon;
        if (coords.length === 2) {
          const x = coords[0];
          const y = coords[1];
          // Web Mercator to WGS84
          lon = (x / 20037508.34) * 180;
          lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
        }
        
        // yon: 1 = Gidiş, 2 = Dönüş
        let direction = '';
        if (props.yon === 1 || props.yon_str === 'G') direction = 'gidis';
        else if (props.yon === 2 || props.yon_str === 'D') direction = 'donus';
        
        return {
          id: props.id || props.durak_id,
          name: props.ad || props.name,
          direction: direction,
          lat, lon,
          sira: props.sira
        };
      });
    } else {
      // Normal JSON array
      arr = Array.isArray(json) ? json : json.stops || json.data || [];
      arr = arr.map(s => {
        const lat = Number(String(s.lat || s.Lat || s.enlem || s.Enlem || '').replace(',', '.'));
        const lon = Number(String(s.lon || s.Lon || s.boylam || s.Boylam || '').replace(',', '.'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          id: s.id || s.stop_id || s.stopId || s.StopId,
          name: s.name || s.stop_name || s.Ad || s.ad || s.stopName,
          direction: s.direction || s.yon || s.Direction || s.Yon || s.YON,
          lat, lon
        };
      });
    }
    
    stops = arr.filter(s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    
    console.log(`Loaded ${stops.length} stops from JSON`, stops.slice(0, 3));
    displayStops();
    log({ status: 'ok', stops: stops.length, sample: stops[0] });
    
  } catch (err) {
    log({ error: err.message });
    console.error(err);
  }
});

// Direction Filter
directionFilter.addEventListener('change', () => {
  if (stops.length > 0) displayStops();
});

// Pipeline Execution
btnPipeline.addEventListener('click', async () => {
  if (!gpsRecords.length) {
    log({ error: 'Önce CSV yükle' });
    return;
  }
  
  try {
    showLoading(btnPipeline, true);
    log('🔄 Pipeline başlatılıyor...\n\nBu 10-60 saniye sürebilir.');
    
    const result = await runStep1Pipeline(gpsRecords, {
      clean: { maxSpeed: 120 },
      segmentation: { timeGapMinutes: 10, minSegmentPoints: 30, minSegmentDistanceMeters: 500 },
      direction: { k: 2, dominantThreshold: 0.8 },
      routeFilter: { eps: 400, minPts: 5, bearingThreshold: 25 },
      snap: { enabled: true },  // OSRM ile yola hizalama açık
      simplify: { targetPoints: 2000, method: 'uniform' }
    });
    
    layers.route.clearLayers();
    const coords = result.route.skeleton.map(p => [p.lat, p.lon]);
    L.polyline(coords, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(layers.route);
    
    // Sanal durakları ekle
    if (result.route.virtualStops && result.route.virtualStops.length > 0) {
      for (const vs of result.route.virtualStops) {
        const marker = L.circleMarker([vs.lat, vs.lon], {
          radius: 5,
          color: '#ffffff',
          fillColor: '#f59e0b', // turuncu
          fillOpacity: 0.8,
          weight: 2
        });
        marker.bindPopup(`Sanal Durak #${vs.stopNumber}<br>${(vs.distance / 1000).toFixed(2)} km<br>Yön: ${vs.bearing.toFixed(0)}°`);
        marker.addTo(layers.route);
      }
    }
    
    if (coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords).pad(0.1));
    }
    
    log({
      status: '✅ Tamamlandı',
      pipeline: result.pipeline,
      skeletonPoints: result.route.skeleton.length,
      totalDistanceKm: result.pipeline.step1E.totalDistanceKm,
      logs: result.log.map(l => l.message)
    });
    
  } catch (err) {
    log({ error: err.message, stack: err.stack });
    console.error(err);
  } finally {
    showLoading(btnPipeline, false);
    btnPipeline.disabled = gpsRecords.length === 0;
  }
});

// Clear
btnClear.addEventListener('click', () => {
  layers.route.clearLayers();
  layers.stops.clearLayers();
  log('Temizlendi.');
});

log('✅ Hazır. CSV ve durak JSON yükleyin.');
