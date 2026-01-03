// 1A: GPS Data Cleaning

export function cleanGPS(records, options = {}) {
  const { maxSpeed = 120 } = options;
  const rejected = { speed: 0, coords: 0, timestamp: 0 };
  const cleaned = [];

  for (const r of records) {
    if (!r.timestamp || !(r.timestamp instanceof Date) || isNaN(r.timestamp.getTime())) {
      rejected.timestamp++;
      continue;
    }
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
      rejected.coords++;
      continue;
    }
    if (r.speed > maxSpeed) {
      rejected.speed++;
      continue;
    }
    cleaned.push(r);
  }

  cleaned.sort((a, b) => {
    const vComp = (a.vehicleId || '').localeCompare(b.vehicleId || '');
    if (vComp !== 0) return vComp;
    return a.timestamp - b.timestamp;
  });

  return { records: cleaned, rejected };
}
