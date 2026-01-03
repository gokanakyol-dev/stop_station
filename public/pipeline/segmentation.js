// 1B: Trip Segmentation

import { haversineDistance, bearing } from './utils.js';

export function segmentTrips(records, options = {}) {
  const { timeGapMinutes = 10, minSegmentPoints = 30, minSegmentDistanceMeters = 500 } = options;
  const timeGapMs = timeGapMinutes * 60 * 1000;
  
  const byVehicle = new Map();
  for (const r of records) {
    const vid = r.vehicleId || 'unknown';
    if (!byVehicle.has(vid)) byVehicle.set(vid, []);
    byVehicle.get(vid).push(r);
  }

  const segments = [];
  for (const [vid, points] of byVehicle) {
    points.sort((a, b) => a.timestamp - b.timestamp);
    
    let current = [];
    for (const p of points) {
      if (current.length > 0 && p.timestamp - current[current.length - 1].timestamp > timeGapMs) {
        if (current.length >= minSegmentPoints) {
          segments.push(computeSegmentProperties(current));
        }
        current = [];
      }
      current.push(p);
    }
    if (current.length >= minSegmentPoints) {
      segments.push(computeSegmentProperties(current));
    }
  }

  return segments.filter(s => s.totalDistance >= minSegmentDistanceMeters);
}

function computeSegmentProperties(points) {
  let totalDist = 0;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const meanLon = lons.reduce((a, b) => a + b, 0) / lons.length;
  
  for (let i = 1; i < points.length; i++) {
    totalDist += haversineDistance(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
  }
  
  const segBearing = bearing(points[0].lat, points[0].lon, points[points.length-1].lat, points[points.length-1].lon);
  
  return {
    points,
    meanLat,
    meanLon,
    bearing: segBearing,
    totalDistance: totalDist,
    startPoint: points[0],
    endPoint: points[points.length - 1]
  };
}
