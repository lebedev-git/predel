import type { LngLat } from './model/geo'
import { PARKING_FLOORS, rectAround, ringAround, type FacilityKind } from './model/place'

// Процедурные модели зданий в стиле архитектурного макета: белый объём, цветная кровля по типу объекта,
// участок с площадками, стадионом и деревьями. Всё — полигоны MapLibre fill-extrusion, без внешних ассетов.

type F = GeoJSON.Feature
const poly = (ring: LngLat[], properties: Record<string, unknown>): F => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } })

export const ROOF: Record<FacilityKind, string> = { kindergarten: '#f0a35e', school: '#5b8def', parking: '#8d98a5', shop: '#3a9d6e' }
const PLOT: Record<FacilityKind, string> = { kindergarten: '#dcebd3', school: '#e1e8f1', parking: '#e6e8eb', shop: '#e9ecef' }
const WALL = '#fbfaf6', TREE = '#7fb685', TRACK = '#d58e6d', FIELD = '#93c879'
const PLAY = ['#f2c14e', '#7cc4e8', '#f28f6b', '#9ad08a']

export interface ModelInput { kind: FacilityKind; center: LngLat; w: number; d: number; amount: number; progress: number; roof?: string; id?: string }

/** Модель объекта: ground — плоские слои участка, ext — объёмы (base/top/color). progress 0…1 — рост по годам стройки. */
export function facilityModel(m: ModelInput): { ground: F[]; ext: F[] } {
  const { center: c, w, d, kind } = m
  const k = Math.max(0, Math.min(1, m.progress))
  const R = (x0: number, y0: number, x1: number, y1: number) => rectAround(c, x0, y0, x1, y1)
  const ground: F[] = [poly(R(-w / 2, -d / 2, w / 2, d / 2), { color: PLOT[kind], id: m.id })]
  const ext: F[] = []
  const box = (x0: number, y0: number, x1: number, y1: number, h: number, roof = m.roof ?? ROOF[kind]) => {
    ext.push(poly(R(x0, y0, x1, y1), { base: 0, top: (h - 0.8) * k, color: WALL, id: m.id }))
    ext.push(poly(R(x0, y0, x1, y1), { base: (h - 0.8) * k, top: h * k, color: roof, id: m.id }))
  }
  const trees = (n: number, inset: number) => {
    if (k < 1) return
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI
      const x = Math.cos(t) * (w / 2 - inset), y = Math.sin(t) * (d / 2 - inset)
      // ствол и крона в два яруса — читается как дерево, а не бочка
      ext.push(poly(ringAround(c, x, y, 0.5, 0.5, 6), { base: 0, top: 2.4, color: '#8a6f55', id: m.id }))
      ext.push(poly(ringAround(c, x, y, 3.4, 3.4, 12), { base: 2.4, top: 5.6, color: TREE, id: m.id }))
      ext.push(poly(ringAround(c, x, y, 2.2, 2.2, 10), { base: 5.6, top: 8.2, color: '#6aa774', id: m.id }))
    }
  }

  if (kind === 'kindergarten') {
    // П-образное здание в 2 этажа с северной стороны, площадки групп — на юге
    const bw = Math.min(w - 16, 34 + m.amount / 6), wing = 13
    const y1 = d / 2 - 8, y0 = y1 - 13
    box(-bw / 2, y0, bw / 2, y1, 7.6)
    box(-bw / 2, y0 - d * 0.28, -bw / 2 + wing, y0, 7.6)
    box(bw / 2 - wing, y0 - d * 0.28, bw / 2, y0, 7.6)
    const cols = Math.max(2, Math.min(6, Math.round(m.amount / 40)))
    for (let i = 0; i < cols; i++) {
      const x = -w / 2 + 10 + ((w - 20) / cols) * (i + 0.5)
      ground.push(poly(R(x - 5, -d / 2 + 8, x + 5, -d / 2 + 18), { color: PLAY[i % PLAY.length], id: m.id }))
      if (k >= 1) ext.push(poly(R(x - 3, -d / 2 + 10, x + 3, -d / 2 + 16), { base: 2.4, top: 2.8, color: PLAY[(i + 1) % PLAY.length], id: m.id }))
    }
    trees(12, 5)
  } else if (kind === 'school') {
    // Ш-образное здание в 4 этажа, стадион с беговой дорожкой — на юге
    const bw = Math.min(w - 20, 90 + m.amount / 20), wing = 16, h = 15.2
    const y1 = d / 2 - 10, y0 = y1 - 17
    box(-bw / 2, y0, bw / 2, y1, h)
    for (const x of [-bw / 2, -wing / 2, bw / 2 - wing]) box(x, y0 - d * 0.22, x + wing, y0, x === -wing / 2 ? h + 3.4 : h - 3.8)
    const sy = -d / 2 + d * 0.24
    ground.push(poly(ringAround(c, 0, sy, Math.min(w * 0.36, 62), Math.min(d * 0.2, 34), 40), { color: TRACK, id: m.id }))
    ground.push(poly(ringAround(c, 0, sy, Math.min(w * 0.36, 62) - 7, Math.min(d * 0.2, 34) - 7, 40), { color: FIELD, id: m.id }))
    trees(18, 6)
  } else if (kind === 'parking') {
    // открытые плиты перекрытий — читается как многоуровневый паркинг
    const bw = w * 0.86, bd = d * 0.8
    for (let i = 0; i <= PARKING_FLOORS; i++) ext.push(poly(R(-bw / 2, -bd / 2, bw / 2, bd / 2), { base: i * 3 * k, top: (i * 3 + 0.5) * k, color: i === PARKING_FLOORS ? ROOF.parking : '#c9ced4', id: m.id }))
    for (const x of [-bw / 2, bw / 2 - 7]) ext.push(poly(R(x, -bd / 2, x + 7, -bd / 2 + 7), { base: 0, top: (PARKING_FLOORS * 3 + 2.5) * k, color: WALL, id: m.id }))
  } else {
    box(-w * 0.35, -d * 0.1, w * 0.35, d * 0.4, 5.5)
    trees(6, 4)
  }
  return { ground, ext }
}
