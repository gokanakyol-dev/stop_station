// 1D: Route Filtering (DBSCAN)

import { haversineDistance, angularDistance } from './utils.js';

export function filterByRouteConsistency(segments, options = {}) {
  const { eps = 400, minPts = 5, bearingThreshold = 25 } = options;
  
  const clusters = dbscan(segments, eps, minPts, bearingThreshold);
  const counts = clusters.map(c => c.length);
  const maxIdx = counts.indexOf(Math.max(...counts));
  
  const dominant = clusters[maxIdx] || [];
  const rejected = segments.filter(s => !dominant.includes(s));
  
  return {
    dominant,
    rejected,
    clusterCount: clusters.length
  };
}

function dbscan(segments, eps, minPts, bearingThreshold) {
  const labels = new Array(segments.length).fill(-1);
  let clusterId = 0;
  
  for (let i = 0; i < segments.length; i++) {
    if (labels[i] !== -1) continue;
    
    const neighbors = regionQuery(segments, i, eps, bearingThreshold);
    if (neighbors.length < minPts) {
      labels[i] = -2; // noise
      continue;
    }
    
    labels[i] = clusterId;
    expandCluster(segments, labels, i, neighbors, clusterId, eps, minPts, bearingThreshold);
    clusterId++;
  }
  
  const clusters = [];
  for (let i = 0; i < clusterId; i++) {
    clusters.push(segments.filter((_, idx) => labels[idx] === i));
  }
  return clusters;
}

function regionQuery(segments, idx, eps, bearingThreshold) {
  const neighbors = [];
  const s = segments[idx];
  
  for (let i = 0; i < segments.length; i++) {
    if (i === idx) continue;
    const dist = haversineDistance(s.meanLat, s.meanLon, segments[i].meanLat, segments[i].meanLon);
    const bearingDiff = angularDistance(s.bearing, segments[i].bearing);
    if (dist <= eps && bearingDiff <= bearingThreshold) {
      neighbors.push(i);
    }
  }
  return neighbors;
}

function expandCluster(segments, labels, idx, neighbors, clusterId, eps, minPts, bearingThreshold) {
  const queue = [...neighbors];
  while (queue.length > 0) {
    const current = queue.shift();
    if (labels[current] === -2) labels[current] = clusterId;
    if (labels[current] !== -1) continue;
    
    labels[current] = clusterId;
    const newNeighbors = regionQuery(segments, current, eps, bearingThreshold);
    if (newNeighbors.length >= minPts) {
      queue.push(...newNeighbors);
    }
  }
}
