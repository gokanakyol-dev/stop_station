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
  
  const totalDistance = skeleton.length > 0 ? skeleton[skeleton.length - 1].distance : 0;
  
  console.log(`Route skeleton: ${skeleton.length} points, ${(totalDistance/1000).toFixed(2)}km`);
  
  return { skeleton };
}

// GPS verilerinden tespit edilen durakları (durma noktalarını) işle
export function processDetectedStops(realStops, skeleton) {
  if (!realStops || realStops.length === 0) {
    console.log('processDetectedStops: durak verisi boş');
    return { detectedStops: [], filteredStops: [] };
  }
  
  const MAX_DISTANCE_THRESHOLD = 300; // Maksimum 300m uzaklık
  const detectedStops = []; // GPS'den tespit edilen duraklar
  const filteredStops = []; // Filtrelenenler
  let filteredBySide = 0;
  
  for (const stop of realStops) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      ungroupedStops.push(stop);
      continue;
    }
    
    // Durma noktasını rotaya project et (en yakın skeleton noktası)
    let minDistToRoute = Infinity;
    let closestSkeletonIndex = -1;
    let projectedDistance = 0;
    
    for (let i = 0; i < skeleton.length; i++) {
      const dist = haversineDistance(stop.lat, stop.lon, skeleton[i].lat, skeleton[i].lon);
      if (dist < minDistToRoute) {
        minDistToRoute = dist;
        closestSkeletonIndex = i;
        projectedDistance = skeleton[i].distance;
      }
    }
    
    // Eğer rotaya çok uzaksa, filtrele
    if (minDistToRoute > MAX_DISTANCE_THRESHOLD) {
      console.log(`Stop '${stop.name || stop.id}' rotaya çok uzak (${minDistToRoute.toFixed(0)}m), atlanıyor`);
      filteredStops.push(stop);
      continue;
    }
    
    // Rotanın sağında mı solunda mı kontrolü (cross product)
    // Rota segmentini bul (mevcut nokta ile bir sonraki nokta)
    let segmentIndex = closestSkeletonIndex;
    if (segmentIndex >= skeleton.length - 1) {
      segmentIndex = skeleton.length - 2; // Son nokta için bir önceki segment
    }
    
    const p1 = skeleton[segmentIndex];
    const p2 = skeleton[segmentIndex + 1];
    
    // Cross product ile yön hesapla
    // Pozitif = sağ taraf (karşı yön), Negatif = sol taraf (aynı yön)
    const dx = p2.lon - p1.lon;
    const dy = p2.lat - p1.lat;
    const crossProduct = dx * (stop.lat - p1.lat) - dy * (stop.lon - p1.lon);
    
    // Sağ taraftaki noktaları filtrele (crossProduct > 0 = karşı yön)
    if (crossProduct > 0) {
      console.log(`Stop '${stop.name || stop.id}' rotanın sağ tarafında (karşı yönde), atlanıyor`);
      filteredStops.push(stop);
      filteredBySide++;
      continue;
    }
    
    // Tespit edilen durağı kaydet
    detectedStops.push({
      ...stop,
      distanceAlongRoute: projectedDistance,
      distanceToRoute: minDistToRoute
    });
  }
  
  // Rota mesafesine göre sırala
  detectedStops.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);
  
  // Her durağa sıra numarası ver
  for (let i = 0; i < detectedStops.length; i++) {
    detectedStops[i].sequenceNumber = i + 1;
  }
  
  console.log(`processDetectedStops: ${detectedStops.length} durak tespit edildi, ${filteredStops.length} filtrelendi (${filteredBySide} karşı yönde)`);
  
  // Detaylı tablo formatında yazdır
  console.table(detectedStops.map(s => ({
    'Sıra': s.sequenceNumber,
    'Durak Adı': s.name || s.id || '-',
    'Rotaya Uzaklık': `${s.distanceToRoute.toFixed(0)}m`,
    'Rota Mesafesi': `${(s.distanceAlongRoute / 1000).toFixed(2)}km`
  })));
  
  return { detectedStops, filteredStops };
}

// Gerçek duraklar ile durma noktalarını karşılaştır
export function compareRealStopsWithGroupedStops(realStops, groupedStops) {
  if (!realStops || realStops.length === 0) {
    return { message: 'Gerçek durak verisi yok', matches: [] };
  }
  
  if (!groupedStops || groupedStops.length === 0) {
    return { message: 'Durma noktası verisi yok', matches: [] };
  }
  
  const MATCH_THRESHOLD = 100; // 100m içindeki durma noktaları eşleşme sayılır
  const matches = [];
  const unmatchedRealStops = [];
  const unmatchedGroupedStops = [...groupedStops]; // Kopyasını al
  
  for (const realStop of realStops) {
    if (!Number.isFinite(realStop.lat) || !Number.isFinite(realStop.lon)) {
      continue;
    }
    
    // En yakın durma noktasını bul
    let closestStop = null;
    let minDistance = Infinity;
    let closestIndex = -1;
    
    for (let i = 0; i < groupedStops.length; i++) {
      const groupedStop = groupedStops[i];
      const dist = haversineDistance(realStop.lat, realStop.lon, groupedStop.lat, groupedStop.lon);
      
      if (dist < minDistance) {
        minDistance = dist;
        closestStop = groupedStop;
        closestIndex = i;
      }
    }
    
    if (minDistance <= MATCH_THRESHOLD && closestStop) {
      // Eşleşme var
      matches.push({
        realStop: {
          name: realStop.name || realStop.id,
          direction: realStop.direction,
          sira: realStop.sira,
          lat: realStop.lat,
          lon: realStop.lon
        },
        groupedStop: {
          name: closestStop.name || closestStop.id,
          sequenceNumber: closestStop.sequenceNumber,
          virtualStopNumber: closestStop.virtualStopNumber,
          lat: closestStop.lat,
          lon: closestStop.lon
        },
        distance: minDistance,
        isMatch: true
      });
      
      // Bu durma noktasını eşleşmemiş listesinden çıkar
      const idx = unmatchedGroupedStops.findIndex(s => s.sequenceNumber === closestStop.sequenceNumber);
      if (idx !== -1) {
        unmatchedGroupedStops.splice(idx, 1);
      }
    } else {
      // Eşleşme yok
      unmatchedRealStops.push({
        name: realStop.name || realStop.id,
        direction: realStop.direction,
        sira: realStop.sira,
        closestDistance: minDistance,
        lat: realStop.lat,
        lon: realStop.lon
      });
    }
  }
  
  // İstatistikler
  const distances = matches.map(m => m.distance);
  const stats = {
    totalRealStops: realStops.length,
    totalGroupedStops: groupedStops.length,
    matchedCount: matches.length,
    unmatchedRealStops: unmatchedRealStops.length,
    unmatchedGroupedStops: unmatchedGroupedStops.length,
    matchRate: ((matches.length / realStops.length) * 100).toFixed(1) + '%',
    averageDistance: distances.length > 0 ? (distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(1) + 'm' : 'N/A',
    minDistance: distances.length > 0 ? Math.min(...distances).toFixed(1) + 'm' : 'N/A',
    maxDistance: distances.length > 0 ? Math.max(...distances).toFixed(1) + 'm' : 'N/A'
  };
  
  console.log('\n🔍 GERÇEK DURAKLAR vs DURMA NOKTALARI KARŞILAŞTIRMASI');
  console.log('═'.repeat(60));
  console.log('İstatistikler:', stats);
  console.log('\n📊 Eşleşen Duraklar (', matches.length, 'adet):');
  console.table(matches.map(m => ({
    'Gerçek Durak': m.realStop.name,
    'Durma Noktası': m.groupedStop.name,
    'Mesafe Farkı': m.distance.toFixed(1) + 'm',
    'Sıra No': m.groupedStop.sequenceNumber,
    'Sanal Durak': '#' + m.groupedStop.virtualStopNumber
  })));
  
  if (unmatchedRealStops.length > 0) {
    console.log('\n❌ Eşleşmeyen Gerçek Duraklar (', unmatchedRealStops.length, 'adet):');
    console.table(unmatchedRealStops.map(s => ({
      'Durak Adı': s.name,
      'Yön': s.direction,
      'En Yakın Mesafe': s.closestDistance.toFixed(0) + 'm'
    })));
  }
  
  if (unmatchedGroupedStops.length > 0) {
    console.log('\n⚠️ Gerçek Durağa Eşleşmeyen Durma Noktaları (', unmatchedGroupedStops.length, 'adet):');
    console.table(unmatchedGroupedStops.slice(0, 10).map(s => ({
      'Sıra': s.sequenceNumber,
      'Ad': s.name || '-',
      'Sanal Durak': '#' + s.virtualStopNumber,
      'Rota Mesafesi': (s.distanceAlongRoute / 1000).toFixed(2) + 'km'
    })));
  }
  
  return { stats, matches, unmatchedRealStops, unmatchedGroupedStops };
}
