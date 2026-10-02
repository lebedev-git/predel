export type LngLat = [number, number]

const R = 6371008.8

/** Расстояние по дуге большого круга, метры. */
export function distance(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Круг радиусом r метров как кольцо полигона (для зон доступности на карте). */
export function circle(center: LngLat, r: number, steps = 64): LngLat[] {
  const rad = Math.PI / 180
  const ring: LngLat[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    const dLat = (r * Math.cos(a)) / R / rad
    const dLng = (r * Math.sin(a)) / (R * Math.cos(center[1] * rad)) / rad
    ring.push([center[0] + dLng, center[1] + dLat])
  }
  return ring
}

export function centroid(ring: LngLat[]): LngLat {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
  return [s[0] / pts.length, s[1] / pts.length]
}
