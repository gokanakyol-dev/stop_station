import { runStep1Pipeline } from '../pipeline/index.js';

// DOM Elements
const csvFile = document.getElementById('csvFile');
const stopsFile = document.getElementById('stopsFile');
const directionFilter = document.getElementById('directionFilter');
const btnPipeline = document.getElementById('btnPipeline');
const btnClear = document.getElementById('btnClear');
const output = document.getElementById('output');
const comparisonCard = document.getElementById('comparisonCard');
const comparisonResults = document.getElementById('comparisonResults');

// State
let gpsRecords = [];
let stops = [];
let pipelineResult = null;

// Global API - Console'dan erişim için
window.stopStation = {
  // Yüklenen verilere erişim
  getData: () => ({
    gpsRecords: gpsRecords.length,
    stops: stops.length,
    hasPipelineResult: !!pipelineResult
  }),
  
  // GPS kayıtları analizi
  analyzeGPS: () => {
    if (gpsRecords.length === 0) return 'GPS verisi yüklenmedi';
    
    const speeds = gpsRecords.map(r => r.speed).filter(s => s > 0);
    const lats = gpsRecords.map(r => r.lat);
    const lons = gpsRecords.map(r => r.lon);
    
    return {
      totalRecords: gpsRecords.length,
      speed: {
        min: Math.min(...speeds),
        max: Math.max(...speeds),
        avg: (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2),
        samples: speeds.length
      },
      bounds: {
        latMin: Math.min(...lats).toFixed(6),
        latMax: Math.max(...lats).toFixed(6),
        lonMin: Math.min(...lons).toFixed(6),
        lonMax: Math.max(...lons).toFixed(6)
      },
      timeRange: {
        start: new Date(Math.min(...gpsRecords.map(r => r.timestamp))).toLocaleString('tr-TR'),
        end: new Date(Math.max(...gpsRecords.map(r => r.timestamp))).toLocaleString('tr-TR')
      },
      uniqueVehicles: [...new Set(gpsRecords.map(r => r.vehicleId))].length,
      sample: gpsRecords.slice(0, 3)
    };
  },
  
  // Durakları analiz et
  analyzeStops: () => {
    if (stops.length === 0) return 'Durak verisi yüklenmedi';
    
    const directions = stops.map(s => s.direction || 'unknown');
    const directionCounts = directions.reduce((acc, d) => {
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {});
    
    return {
      totalStops: stops.length,
      directions: directionCounts,
      samples: stops.slice(0, 5).map(s => ({
        id: s.id,
        name: s.name,
        direction: s.direction,
        lat: s.lat.toFixed(6),
        lon: s.lon.toFixed(6)
      }))
    };
  },
  
  // Pipeline sonuçlarını göster
  getPipelineResult: () => {
    if (!pipelineResult) return 'Pipeline henüz çalıştırılmadı';
    return pipelineResult;
  },
  
  // Belirli hız aralığındaki GPS noktalarını filtrele
  filterBySpeed: (minSpeed, maxSpeed) => {
    const filtered = gpsRecords.filter(r => r.speed >= minSpeed && r.speed <= maxSpeed);
    console.table(filtered.slice(0, 20).map(r => ({
      'Plaka': r.vehicleId,
      'Hız': r.speed,
      'Enlem': r.lat.toFixed(6),
      'Boylam': r.lon.toFixed(6),
      'Zaman': new Date(r.timestamp).toLocaleTimeString('tr-TR')
    })));
    return `${filtered.length} kayıt bulundu (ilk 20 gösterildi)`;
  },
  
  // Tespit edilen durakları göster
  getDetectedStops: () => {
    if (!pipelineResult?.stops?.detectedStops) return 'Duraklar henüz tespit edilmedi';
    const detected = pipelineResult.stops.detectedStops;
    console.table(detected.map(s => ({
      'Sıra': s.sequenceNumber,
      'Durak': s.name || s.id,
      'Rota Mesafesi': `${(s.distanceAlongRoute / 1000).toFixed(2)}km`,
      'Uzaklık': `${s.distanceToRoute.toFixed(0)}m`
    })));
    return `${detected.length} durak tespit edildi`;
  },
  
  // Gerçek duraklar ile tespit edilen durakları karşılaştır
  compareStops: () => {
    if (!pipelineResult?.comparison) return 'Karşılaştırma yapılmadı. Pipeline çalıştırın.';
    const comp = pipelineResult.comparison;
    
    console.log('\n🔍 GERÇEK DURAKLAR vs TESPİT EDİLEN DURAKLAR');
    console.log('═'.repeat(50));
    console.log(comp.stats);
    
    if (comp.matches.length > 0) {
      console.log('\n✅ Eşleşen Duraklar:');
      console.table(comp.matches.map(m => ({
        'Gerçek Durak': m.realStop.name,
        'Tespit Edilen': m.groupedStop.name,
        'Fark': m.distance.toFixed(1) + 'm',
        'Sıra': m.groupedStop.sequenceNumber
      })));
    }
    
    if (comp.unmatchedRealStops.length > 0) {
      console.log('\n❌ Eşleşmeyen Gerçek Duraklar:');
      console.table(comp.unmatchedRealStops.map(s => ({
        'Durak': s.name,
        'Yön': s.direction,
        'En Yakın': s.closestDistance.toFixed(0) + 'm'
      })));
    }
    
    return comp.stats;
  },
  
  // Yardım
  help: () => {
    console.log(`
🚏 Stop Station Terminal Komutları:

stopStation.getData()              - Yüklenen veri sayıları
stopStation.analyzeGPS()           - GPS verisi detaylı analiz
stopStation.analyzeStops()         - Durak verisi analizi
stopStation.filterBySpeed(min, max) - Hız filtreleme
stopStation.getPipelineResult()    - Pipeline sonuçları
stopStation.getDetectedStops()     - Tespit edilen duraklar
stopStation.compareStops()         - Gerçek duraklar vs tespit edilen duraklar
stopStation.help()                 - Bu yardım metni

Örnekler:
  stopStation.analyzeGPS()         // Tüm GPS verisi analizi
  stopStation.filterBySpeed(0, 10) // Duran araçlar (0-10 km/h)
  stopStation.getDetectedStops()   // Tespit edilen duraklar tablosu
  stopStation.compareStops()       // Gerçek duraklar ile karşılaştırma
    `);
    return 'Komutlar console\'a yazdırıldı';
  }
};

// Map Setup
const map = L.map('map').setView([41.0, 28.9], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);

// Legend (Harita Açıklaması) ekle
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function(map) {
  const div = L.DomUtil.create('div', 'map-legend');
  div.innerHTML = `
    <h4>🗺️ Harita Açıklaması</h4>
    <div class="legend-item">
      <span class="legend-icon" style="background: #2563eb; border: 2px solid #fff;"></span>
      <span>Rota</span>
    </div>
    <div class="legend-item">
      <span class="legend-icon" style="background: #10b981; border: 2px solid #fff;"></span>
      <span>📍 Gerçek Durak (Gidiş)</span>
    </div>
    <div class="legend-item">
      <span class="legend-icon" style="background: #ef4444; border: 2px solid #fff;"></span>
      <span>📍 Gerçek Durak (Dönüş)</span>
    </div>
    <div class="legend-item">
      <span class="legend-icon" style="background: #60a5fa; border: 3px solid #3b82f6;"></span>
      <span>⭐ Tespit Edilen Durak (GPS)</span>
    </div>
  `;
  return div;
};
legend.addTo(map);

const layers = {
  route: L.layerGroup().addTo(map),
  realStops: L.layerGroup().addTo(map),        // JSON'dan yüklenen gerçek duraklar
  detectedStops: L.layerGroup().addTo(map)     // GPS'den tespit edilen duraklar
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
  layers.realStops.clearLayers();
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
    
    // GERÇEK DURAKLAR - Kare şeklinde, daha büyük
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 10,
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 0.95,
      weight: 3
    });
    
    const popupText = `<b>📍 GERÇEK DURAK</b><br><b>${s.name || s.id || 'Durak'}</b><br>Yön: ${s.direction || s.yon || 'bilinmiyor'}<br>Sıra: ${s.sira || '-'}`;
    marker.bindPopup(popupText);
    marker.addTo(layers.realStops);
  }
  
  console.log(`${filtered.length} gerçek durak haritaya eklendi (yeşil/kırmızı layer)`);
}

function displayComparison(comparison) {
  if (!comparison) {
    comparisonCard.style.display = 'none';
    return;
  }
  
  comparisonCard.style.display = 'block';
  
  const stats = comparison.stats;
  let html = `
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-label">Toplam Gerçek Durak</div>
        <div class="stat-value">${stats.totalRealStops}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Tespit Edilen Durak</div>
        <div class="stat-value">${stats.totalGroupedStops}</div>
      </div>
      <div class="stat-box success">
        <div class="stat-label">Eşleşen</div>
        <div class="stat-value">${stats.matchedCount}</div>
      </div>
      <div class="stat-box success">
        <div class="stat-label">Eşleşme Oranı</div>
        <div class="stat-value">${stats.matchRate}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Ortalama Mesafe Farkı</div>
        <div class="stat-value">${stats.averageDistance}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Min / Max Mesafe</div>
        <div class="stat-value">${stats.minDistance} / ${stats.maxDistance}</div>
      </div>
    </div>
  `;
  
  // Eşleşen duraklar
  if (comparison.matches.length > 0) {
    html += `
      <h3 style="margin-top: 20px; color: #10b981;">✅ Eşleşen Duraklar (${comparison.matches.length} adet)</h3>
      <div class="comparison-table">
        <table>
          <thead>
            <tr>
              <th>Gerçek Durak</th>
              <th>Yön</th>
              <th>Tespit Edilen</th>
              <th>Sıra No</th>
              <th>Mesafe Farkı</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    comparison.matches.forEach(m => {
      html += `
        <tr>
          <td><strong>${m.realStop.name}</strong></td>
          <td>${m.realStop.direction || '-'}</td>
          <td>${m.groupedStop.name || '-'}</td>
          <td>#${m.groupedStop.sequenceNumber}</td>
          <td>${m.distance.toFixed(1)}m</td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  }
  
  // Eşleşmeyen gerçek duraklar
  if (comparison.unmatchedRealStops.length > 0) {
    html += `
      <h3 style="margin-top: 20px; color: #ef4444;">❌ Eşleşmeyen Gerçek Duraklar (${comparison.unmatchedRealStops.length} adet)</h3>
      <p style="color: #6b7280; font-size: 14px;">GPS verilerinde bu duraklarda durma tespit edilmedi</p>
      <div class="comparison-table">
        <table>
          <thead>
            <tr>
              <th>Durak Adı</th>
              <th>Yön</th>
              <th>Sıra</th>
              <th>En Yakın Tespit</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    comparison.unmatchedRealStops.forEach(s => {
      html += `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td>${s.direction || '-'}</td>
          <td>${s.sira || '-'}</td>
          <td>${s.closestDistance.toFixed(0)}m</td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  }
  
  // Eşleşmeyen tespit edilen duraklar
  if (comparison.unmatchedGroupedStops.length > 0) {
    const displayCount = Math.min(10, comparison.unmatchedGroupedStops.length);
    html += `
      <h3 style="margin-top: 20px; color: #f59e0b;">⚠️ Eşleşmeyen Tespit Edilen Duraklar (${comparison.unmatchedGroupedStops.length} adet)</h3>
      <p style="color: #6b7280; font-size: 14px;">Gerçek durağa karşılık gelmeyen tespit edilen duraklar (muhtemelen yanlış tespit)</p>
      <div class="comparison-table">
        <table>
          <thead>
            <tr>
              <th>Sıra No</th>
              <th>Ad</th>
              <th>Rota Mesafesi</th>
              <th>Rotaya Uzaklık</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    comparison.unmatchedGroupedStops.slice(0, displayCount).forEach(s => {
      html += `
        <tr>
          <td>#${s.sequenceNumber}</td>
          <td>${s.name || '-'}</td>
          <td>${(s.distanceAlongRoute / 1000).toFixed(2)}km</td>
          <td>${s.distanceToRoute.toFixed(0)}m</td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
    
    if (comparison.unmatchedGroupedStops.length > displayCount) {
      html += `<p style="color: #6b7280; font-size: 13px; margin-top: 10px;">... ve ${comparison.unmatchedGroupedStops.length - displayCount} tane daha</p>`;
    }
  }
  
  comparisonResults.innerHTML = html;
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
    
    // Yön filtresine göre durakları filtrele
    const filter = directionFilter.value;
    let filteredStops = stops;
    
    if (filter !== 'all' && stops.length > 0) {
      filteredStops = stops.filter(s => {
        const dir = (s.direction || s.yon || '').toLowerCase();
        if (filter === 'gidis') return dir.includes('gidis') || dir.includes('gıdis') || dir === '0' || s.yon === 1;
        if (filter === 'donus') return dir.includes('donus') || dir.includes('dönus') || dir === '1' || s.yon === 2;
        return true;
      });
      
      console.log(`Pipeline: ${stops.length} duraktan ${filteredStops.length} tanesi ${filter} yönü için kullanılacak`);
    }
    
    const result = await runStep1Pipeline(gpsRecords, {
      clean: { maxSpeed: 120 },
      segmentation: { timeGapMinutes: 10, minSegmentPoints: 30, minSegmentDistanceMeters: 500 },
      direction: { k: 2, dominantThreshold: 0.8 },
      routeFilter: { eps: 400, minPts: 5, bearingThreshold: 25 },
      snap: { enabled: true },  // OSRM ile yola hizalama açık
      simplify: { targetPoints: 2000, method: 'uniform' },
      stops: filteredStops  // Filtrelenmiş durakları gönder
    });
    
    // Sonucu kaydet
    pipelineResult = result;
    
    layers.route.clearLayers();
    const coords = result.route.skeleton.map(p => [p.lat, p.lon]);
    L.polyline(coords, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(layers.route);
    
    // Tespit edilen durakları ekle (mavi yıldız)
    layers.detectedStops.clearLayers();
    if (result.stops && result.stops.detectedStops && result.stops.detectedStops.length > 0) {
      for (const stop of result.stops.detectedStops) {
        const marker = L.circleMarker([stop.lat, stop.lon], {
          radius: 8,
          color: '#3b82f6',
          fillColor: '#60a5fa', // açık mavi
          fillOpacity: 0.95,
          weight: 3
        });
        
        const popupText = `<b>⭐ TESPİT EDİLEN DURAK</b><br>` +
          `<b>${stop.name || stop.id || 'Durak'}</b><br>` +
          `Sıra No: <b>#${stop.sequenceNumber}</b><br>` +
          `Rotaya Uzaklık: ${stop.distanceToRoute.toFixed(0)}m<br>` +
          `Rota Üzerinde: ${(stop.distanceAlongRoute / 1000).toFixed(2)}km`;
        
        marker.bindPopup(popupText);
        marker.addTo(layers.detectedStops);
      }
      
      console.log(`${result.stops.detectedStops.length} tespit edilen durak haritaya eklendi (mavi layer)`);
    }
    
    if (coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords).pad(0.1));
    }
    
    log({
      status: '✅ Tamamlandı',
      pipeline: result.pipeline,
      skeletonPoints: result.route.skeleton.length,
      totalDistanceKm: result.pipeline.step1E.totalDistanceKm,
      stopDetection: result.stops ? {
        detected: result.stops.detectedStops.length,
        filtered: result.stops.filteredStops.length
      } : null,
      stopComparison: result.comparison ? result.comparison.stats : null,
      logs: result.log.map(l => l.message)
    });
    
    // Karşılaştırma sonuçlarını console'a yazdır
    if (result.comparison) {
      console.log('\n\n' + '═'.repeat(70));
      console.log('🔍 GERÇEK DURAKLAR vs TESPİT EDİLEN DURAKLAR');
      console.log('═'.repeat(70));
      console.log('\n📊 İSTATİSTİKLER:');
      console.table({
        'Toplam Gerçek Durak': result.comparison.stats.totalRealStops,
        'Toplam Tespit Edilen': result.comparison.stats.totalGroupedStops,
        'Eşleşen': result.comparison.stats.matchedCount,
        'Eşleşme Oranı': result.comparison.stats.matchRate,
        'Ortalama Mesafe Farkı': result.comparison.stats.averageDistance,
        'Min Mesafe': result.comparison.stats.minDistance,
        'Max Mesafe': result.comparison.stats.maxDistance
      });
      
      // Sayfada göster
      displayComparison(result.comparison);
    }
    
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
  layers.realStops.clearLayers();
  layers.detectedStops.clearLayers();
  comparisonCard.style.display = 'none';
  log('Temizlendi.');
});

log('✅ Hazır. CSV ve durak JSON yükleyin.');

// Console'da yardım göster
console.log('%c🚏 Stop Station - Terminal API Hazır', 'color: #10b981; font-size: 14px; font-weight: bold');
console.log('%cKomutlar için: stopStation.help()', 'color: #3b82f6; font-size: 12px');
console.log('%cÖrnek: stopStation.analyzeGPS()', 'color: #6b7280; font-size: 11px');
