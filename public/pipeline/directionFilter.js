// 1C: Direction Filtering

import { circularMean, angularDistance } from './utils.js';

export function computeSegmentHeadings(segments) {
  return segments.map(s => ({
    ...s,
    medianHeading: s.bearing,
    headingDispersion: 0
  }));
}

export function clusterByDirection(segments, options = {}) {
  const { k = 2, dominantThreshold = 0.8 } = options;
  
  const bearings = segments.map(s => s.bearing);
  const clusters = kMeansCircular(bearings, k);
  
  const counts = clusters.map(c => c.indices.length);
  const maxIdx = counts.indexOf(Math.max(...counts));
  const dominant = clusters[maxIdx];
  
  return {
    clusters,
    selected: {
      segments: dominant.indices.map(i => segments[i]),
      meanHeading: dominant.center,
      count: dominant.indices.length
    },
    dominantRatio: dominant.indices.length / segments.length
  };
}

function kMeansCircular(angles, k) {
  let centers = [];
  for (let i = 0; i < k; i++) {
    centers.push((360 / k) * i);
  }
  
  for (let iter = 0; iter < 10; iter++) {
    const assignments = angles.map(a => {
      const dists = centers.map(c => angularDistance(a, c));
      return dists.indexOf(Math.min(...dists));
    });
    
    for (let i = 0; i < k; i++) {
      const clusterAngles = angles.filter((_, idx) => assignments[idx] === i);
      if (clusterAngles.length > 0) {
        centers[i] = circularMean(clusterAngles);
      }
    }
  }
  
  const finalAssignments = angles.map(a => {
    const dists = centers.map(c => angularDistance(a, c));
    return dists.indexOf(Math.min(...dists));
  });
  
  return centers.map((center, i) => ({
    center,
    indices: finalAssignments.map((a, idx) => a === i ? idx : -1).filter(x => x >= 0)
  }));
}
