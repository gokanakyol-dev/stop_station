// 1E: Route Construction

import { haversineDistance, circularMean, bearing } from './utils.js';

// Heading Consistency Filter: Ani yön değişimlerini (>120°) temizler
const HEADING_FILTER_MAX_ANGLE = 120;

function filterByHeadingConsistency(points) {
  if (points.length < 3) return points;
  
  const filtered = [points[0]]; // ilk nokta her zaman
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    // prev -> curr yönü
    const bear1 = bearing(prev.lat, prev.lon, curr.lat, curr.lon);
    // curr -> next yönü
    const bear2 = bearing(curr.lat, curr.lon, next.lat, next.lon);
    
    // Açı farkı (0-180 arası)
    let diff = Math.abs(bear1 - bear2);
    if (diff > 180) diff = 360 - diff;
    
    // Eğer açı farkı çok büyükse bu nokta "geri dönüş" noktası, atla
    if (diff <= HEADING_FILTER_MAX_ANGLE) {
      filtered.push(curr);
    } else {
      console.log(`HeadingFilter: Nokta atlandı (index ${i}, açı farkı ${diff.toFixed(0)}°)`);
    }
  }
  
  filtered.push(points[points.length - 1]); // son nokta her zaman
  
  console.log(`HeadingFilter: ${points.length} -> ${filtered.length} nokta (${points.length - filtered.length} atlandı)`);
  return filtered;
}

export function buildRoute(segments) {
  if (segments.length === 0) return { points: [], stats: { totalPoints: 0, segmentCount: 0, deduplicatedPoints: 0 } };
  
  // SADECE EN BÜYÜK SEGMENTİ SEÇ (en çok nokta içeren)
  const largestSegment = segments.reduce((max, seg) => 
    seg.points.length > max.points.length ? seg : max
  , segments[0]);
  
  console.log(`buildRoute: ${segments.length} segment içinden en büyüğü seçildi (${largestSegment.points.length} nokta)`);
  
  // Bu segmenti timestamp'e göre sırala
  const allPoints = largestSegment.points.slice().sort((a, b) => a.timestamp - b.timestamp);
  
  // Consecutive duplicate removal
  const deduplicated = [];
  let prevKey = null;
  for (const p of allPoints) {
    const key = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    if (key !== prevKey) {
      deduplicated.push(p);
      prevKey = key;
    }
  }
  
  return { 
    points: deduplicated, 
    stats: { 
      totalPoints: largestSegment.points.length, 
      segmentCount: 1,
      deduplicatedPoints: deduplicated.length,
      originalSegmentCount: segments.length
    } 
  };
}

function simplifySegmentPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * (points.length - 1)) / (maxPoints - 1));
    sampled.push(points[idx]);
  }
  return sampled;
}

export async function snapToRoad(points, options = {}) {
  const { maxPointsPerRequest = 50, profile = 'driving' } = options;
  if (points.length === 0) return { snapped: [], matchInfo: null, chunkCount: 0 };
  
  const chunks = [];
  for (let i = 0; i < points.length; i += maxPointsPerRequest) {
    chunks.push(points.slice(i, i + maxPointsPerRequest));
  }
  
  const allSnapped = [];
  const matchInfos = [];
  
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const coords = chunk.map(p => `${p.lon},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/match/v1/${profile}/${coords}?geometries=geojson&overview=full`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok') throw new Error(`OSRM error: ${data.code}`);
      
      const matching = data.matchings?.[0];
      if (matching?.geometry?.coordinates?.length) {
        const snappedCoords = matching.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
        allSnapped.push(...snappedCoords);
        matchInfos.push({ confidence: matching.confidence, distance: matching.distance, duration: matching.duration });
      }
    } catch (err) {
      console.warn(`OSRM chunk ${chunkIdx + 1} failed:`, err.message);
    }
  }
  
  return { snapped: allSnapped, matchInfo: matchInfos[0] || null, chunkCount: chunks.length };
}

export function simplifyRoute(points, options = {}) {
  const { targetPoints = 500 } = options;
  if (points.length <= targetPoints) return points;
  const sampled = [];
  for (let i = 0; i < targetPoints; i++) {
    const idx = Math.round((i * (points.length - 1)) / (targetPoints - 1));
    sampled.push(points[idx]);
  }
  return sampled;
}

export function computeRouteSkeleton(points) {
  // Heading filter ile temizlenmiş noktalar
  const cleanedPoints = filterByHeadingConsistency(points);
  
  const skeleton = [];
  let cumulativeDist = 0;
  
  for (let i = 0; i < cleanedPoints.length; i++) {
    if (i > 0) {
      cumulativeDist += haversineDistance(cleanedPoints[i-1].lat, cleanedPoints[i-1].lon, cleanedPoints[i].lat, cleanedPoints[i].lon);
    }
    const bear = i < cleanedPoints.length - 1 ? bearing(cleanedPoints[i].lat, cleanedPoints[i].lon, cleanedPoints[i+1].lat, cleanedPoints[i+1].lon) : skeleton[i-1]?.bearing || 0;
    skeleton.push({ ...cleanedPoints[i], distance: cumulativeDist, bearing: bear });
  }
  
  const virtualStops = [];
  
  if (skeleton.length === 0) {
    return { skeleton, virtualStops };
  }
  
  const totalDistance = skeleton[skeleton.length - 1].distance;
  
  // İlk konum (0m)
  virtualStops.push({
    lat: skeleton[0].lat,
    lon: skeleton[0].lon,
    distance: 0,
    bearing: skeleton[0].bearing,
    isVirtual: true,
    stopNumber: 0,
    isStart: true
  });
  
  // Her 500m'de sanal durak ekle
  let stopNumber = 1;
  let nextStopDistance = 500;
  
  for (let i = 0; i < skeleton.length - 1; i++) {
    const p1 = skeleton[i];
    const p2 = skeleton[i + 1];
    
    // Bu segment içinde 500m sınırlarını bul
    while (nextStopDistance > p1.distance && nextStopDistance <= p2.distance) {
      // Toplam mesafeyi geçmemek için kontrol
      if (nextStopDistance >= totalDistance) break;
      
      const segmentDist = p2.distance - p1.distance;
      if (segmentDist === 0) break; // Aynı noktalar, ilerle
      
      const ratio = (nextStopDistance - p1.distance) / segmentDist;
      
      // İnterpolate lat/lon
      const lat = p1.lat + (p2.lat - p1.lat) * ratio;
      const lon = p1.lon + (p2.lon - p1.lon) * ratio;
      
      virtualStops.push({
        lat, lon,
        distance: nextStopDistance,
        bearing: p1.bearing,
        isVirtual: true,
        stopNumber: stopNumber
      });
      
      stopNumber++;
      nextStopDistance += 500;
    }
  }
  
  // Son konum (totalDistance)
  const lastPoint = skeleton[skeleton.length - 1];
  virtualStops.push({
    lat: lastPoint.lat,
    lon: lastPoint.lon,
    distance: totalDistance,
    bearing: lastPoint.bearing,
    isVirtual: true,
    stopNumber: stopNumber,
    isEnd: true
  });
  
  console.log(`Route skeleton: ${skeleton.length} points, ${virtualStops.length} virtual stops (0m to ${(totalDistance/1000).toFixed(2)}km)`);
  
  return { skeleton, virtualStops };
}
