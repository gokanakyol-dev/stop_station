// Pipeline Orchestrator

import { cleanGPS } from './cleanGPS.js';
import { segmentTrips } from './segmentation.js';
import { computeSegmentHeadings, clusterByDirection } from './directionFilter.js';
import { filterByRouteConsistency } from './routeFilter.js';
import { buildRoute, snapToRoad, simplifyRoute, computeRouteSkeleton } from './routeConstruction.js';
import { haversineDistance } from './utils.js';

function chunkEvenly(items, max) {
  if (items.length <= max) return items;
  const out = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (items.length - 1)) / (max - 1));
    out.push(items[idx]);
  }
  return out;
}

function thinPointsForOsrm(points, options = {}) {
  const { minStepMeters = 10, maxPoints = 800 } = options;
  if (!points?.length) return [];
  if (points.length <= maxPoints) return points;

  const thinned = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = haversineDistance(last.lat, last.lon, p.lat, p.lon);
    if (d >= minStepMeters) {
      thinned.push(p);
      last = p;
      if (thinned.length >= maxPoints - 1) break;
    }
  }
  thinned.push(points[points.length - 1]);
  return thinned;
}

export async function runStep1Pipeline(gpsRecords, options = {}) {
  const log = [];
  const step = (msg, alsoConsole = true) => {
    log.push({ timestamp: Date.now(), message: msg });
    if (alsoConsole) console.log(`[Pipeline] ${msg}`);
  };

  step('1A - GPS Temizliği...');
  const { records: cleanedRecords, rejected } = cleanGPS(gpsRecords, options.clean);
  step(`1A: ${cleanedRecords.length} kayıt, ${rejected.speed + rejected.coords + rejected.timestamp} reddedildi`);
  if (cleanedRecords.length === 0) throw new Error('Temizlikten sonra GPS kaydı kalmadı');

  step('1B - Segmentasyon...');
  const segments = segmentTrips(cleanedRecords, options.segmentation);
  step(`1B: ${segments.length} segment`);
  if (segments.length === 0) throw new Error('Segment oluşturulamadı');

  step('1C - Yön Ayırma...');
  const segmentSummaries = computeSegmentHeadings(segments);
  const { clusters, selected, dominantRatio } = clusterByDirection(segmentSummaries, options.direction);
  step(`1C: ${clusters.length} küme, baskın oran ${(dominantRatio * 100).toFixed(1)}%`);
  if (!selected || selected.segments.length === 0) throw new Error('Yön ayırma sonrası segment kalmadı');

  step('1D - Route Filtering (DBSCAN)...');
  const { dominant, rejected: rejectedRoute, clusterCount } = filterByRouteConsistency(selected.segments, options.routeFilter);
  step(`1D: ${dominant.length} segment kabul, ${rejectedRoute.length} reddedildi`);
  if (dominant.length === 0) throw new Error('DBSCAN sonrası segment kalmadı');

  step('1E - Route İnşası...');
  const { points: routePoints, stats } = buildRoute(dominant);
  step(`1E.1: ${stats.deduplicatedPoints} nokta`);

  // OSRM snap varsayılan olarak AÇIK (yola hizalama için)
  const snapEnabled = options.snap?.enabled !== false; // default: true
  let snappedPoints = routePoints;
  let matchInfo = null;

  if (!snapEnabled) {
    step('1E.2: OSRM snap kapalı, raw GPS noktaları kullanılıyor');
  } else {
    step('1E.2: OSRM ile yola hizalama...');
    // Daha agresif inceltme: daha az nokta = daha az chunk = daha hızlı
    const osrmInput = thinPointsForOsrm(routePoints, { minStepMeters: 50, maxPoints: 200 });
    const osrmPrimary = await snapToRoad(osrmInput, { maxPointsPerRequest: 100, profile: 'driving' });

    // Fallback: OSRM boş dönerse sampled yaklaşım
    const needsFallback = !osrmPrimary.snapped?.length;
    const osrmResult = needsFallback
      ? await snapToRoad(chunkEvenly(routePoints, Math.min(100, routePoints.length)), { maxPointsPerRequest: 100, profile: 'driving' })
      : osrmPrimary;

    snappedPoints = osrmResult.snapped.length > 0 ? osrmResult.snapped : routePoints;
    matchInfo = osrmResult.matchInfo ?? null;
    const confStr = matchInfo?.confidence?.toFixed(2) ?? 'N/A';
    step(`1E.2: ${snappedPoints.length} nokta yola hizalandı (confidence: ${confStr})`);
  }

  step('1E.3: Sadeleştirme...', false);
  const skeleton = simplifyRoute(snappedPoints, options.simplify);
  if (skeleton.length < 2) throw new Error('Route skeleton oluşturulamadı');

  const routeData = computeRouteSkeleton(skeleton);
  const routeSkeleton = routeData.skeleton;
  const virtualStops = routeData.virtualStops;
  const totalDistance = routeSkeleton[routeSkeleton.length - 1]?.distance ?? 0;
  step(`1E.4: ${routeSkeleton.length} nokta, ${(totalDistance / 1000).toFixed(2)} km, ${virtualStops.length} sanal durak`);

  return {
    log,
    pipeline: {
      step1A: { cleanedCount: cleanedRecords.length, rejected },
      step1B: { segmentCount: segments.length },
      step1C: { clusterCount: clusters.length, selectedDirection: selected.meanHeading, dominantRatio },
      step1D: { dominantCount: dominant.length, rejectedCount: rejectedRoute.length, clusterCount },
      step1E: { totalPoints: stats.totalPoints, deduplicatedPoints: stats.deduplicatedPoints, snappedPoints: snappedPoints.length, skeletonPoints: routeSkeleton.length, totalDistanceKm: totalDistance / 1000, matchInfo, virtualStops: virtualStops.length }
    },
    route: { raw: routePoints, snapped: snappedPoints, skeleton: routeSkeleton, virtualStops }
  };
}
