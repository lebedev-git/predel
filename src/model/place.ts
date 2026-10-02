import { centroid, type LngLat } from './geo'
import type { District, Project } from './model'

// Размещение новых объектов (мероприятий) на карте: участок по нормативу, свободное место в радиусе доступности —
// не на зданиях, не на дорогах и не на участке ЖК. Это не проект планировки, а проверка «есть ли куда поставить».

export type FacilityKind = 'kindergarten' | 'school' | 'parking' | 'shop'
export interface Facility { id: string; kind: FacilityKind; amount: number; year: number; label: string }
export interface Placed extends Facility {
  center: LngLat
  w: number // размер участка, м (восток — запад)
  d: number // м (север — юг)
  plotArea: number // нормативная площадь участка, м²
  dist: number // от центра ЖК, м
  inRadius: boolean // нашлось ли место в нормативном радиусе
  found: boolean // нашлось ли свободное место вообще (до 1,6 радиуса); нет — на карте не рисуем
}

/** Нормативная площадь участка, м². Сад: СП 42.13330.2016, табл. Д.1 — 44 м²/место до 100 мест, 38 — свыше.
 *  Школа: та же таблица в ред. Изменения № 3 (приказ Минстроя № 473/пр от 09.06.2022), м² на обучающегося. */
export function plotArea(kind: FacilityKind, amount: number) {
  if (kind === 'kindergarten') return amount * (amount <= 100 ? 44 : 38)
  if (kind === 'school') {
    const per = amount <= 170 ? 80 : amount <= 340 ? 55 : amount <= 510 ? 40 : amount <= 660 ? 35 : amount <= 1000 ? 28 : amount <= 1500 ? 24 : 22
    return amount * per
  }
  if (kind === 'parking') return (amount * 25) / PARKING_FLOORS * 1.25 // 25 м² на место с проездами, многоуровневый, + отступы
  return amount * 2.5 // магазин: торговый зал ≈ 60% здания + разгрузка и стоянка
}
export const PARKING_FLOORS = 6
const ASPECT: Record<FacilityKind, number> = { kindergarten: 1.35, school: 1.55, parking: 1.6, shop: 1.5 }
export const PLACE_RADIUS: Record<FacilityKind, number> = { kindergarten: 500, school: 500, parking: 400, shop: 500 }

type Box = [number, number, number, number] // x0, y0, x1, y1 в метрах от центра
type Seg = [number, number, number, number, number] // x0, y0, x1, y1, полуширина с отступом

const ROAD_HALF: Record<string, number> = { motorway: 16, trunk: 16, primary: 14, secondary: 11, tertiary: 9 }
/** Подложка, на которой новые объекты не ставим: вода, парки, лес, кладбища (кварталы пустой территории — можно). */
const BLOCKED_GROUND = new Set(['water', 'park'])

function insideRing(x: number, y: number, pts: [number, number][]) {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
type Area = { box: Box; pts: [number, number][]; kind: string }
/** Полигоны подложки в метрах: граница — в сетку как отрезки, целиком внутри — проверка центра. */
function areas(district: District, f: ReturnType<typeof frame>, reach: number) {
  const out: Area[] = []
  for (const [kind, ring] of district.ground ?? []) {
    if (!BLOCKED_GROUND.has(kind)) continue
    const pts = ring.map(f.to)
    const box = boxOf(pts, 0)
    if (box[2] < -reach || box[0] > reach || box[3] < -reach || box[1] > reach) continue
    out.push({ box, pts, kind })
  }
  return out
}
const inArea = (as: Area[], x: number, y: number) => as.find(a => x > a.box[0] && x < a.box[2] && y > a.box[1] && y < a.box[3] && insideRing(x, y, a.pts))

/** Перевод в метры от центра (равнопромежуточная проекция — на 2 км ошибка меньше метра). */
function frame(center: LngLat) {
  const kx = 111_320 * Math.cos((center[1] * Math.PI) / 180), ky = 111_200
  return {
    to: (p: LngLat): [number, number] => [(p[0] - center[0]) * kx, (p[1] - center[1]) * ky],
    from: (x: number, y: number): LngLat => [center[0] + x / kx, center[1] + y / ky],
  }
}

const boxOf = (pts: [number, number][], m: number): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0 - m, y0 - m, x1 + m, y1 + m]
}
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** Отрезок пересекает прямоугольник, расширенный на полуширину дороги (отсечение Лианга — Барски). */
function segHit(s: Seg, b: Box) {
  const [x0, y0, x1, y1, h] = s
  const bx0 = b[0] - h, by0 = b[1] - h, bx1 = b[2] + h, by1 = b[3] + h
  const dx = x1 - x0, dy = y1 - y0
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, x0 - bx0], [dx, bx1 - x0], [-dy, y0 - by0], [dy, by1 - y0]]) {
    if (p === 0) { if (q < 0) return false; continue }
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r } else { if (r < t0) return false; if (r < t1) t1 = r }
  }
  return true
}

/** Сетка 50 м: препятствия раскладываются по ячейкам, кандидат проверяется только с соседями. */
function grid() {
  const cell = 50
  const boxes = new Map<string, Box[]>(), segs = new Map<string, Seg[]>()
  const cells = (b: Box) => {
    const out: string[] = []
    for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++) for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) out.push(`${i},${j}`)
    return out
  }
  return {
    addBox(b: Box) { for (const k of cells(b)) (boxes.get(k) ?? boxes.set(k, []).get(k)!).push(b) },
    addSeg(s: Seg) { for (const k of cells(boxOf([[s[0], s[1]], [s[2], s[3]]], s[4]))) (segs.get(k) ?? segs.set(k, []).get(k)!).push(s) },
    free(b: Box) {
      for (const k of cells(b)) {
        if (boxes.get(k)?.some(o => hit(o, b))) return false
        if (segs.get(k)?.some(s => segHit(s, b))) return false
      }
      return true
    },
  }
}

/** Ставит объекты по очереди: ближе к ЖК — лучше; каждый следующий не залезает на предыдущие. */
export function placeFacilities(district: District, project: Project, facilities: Facility[], center: LngLat): Placed[] {
  const f = frame(center)
  const g = grid()
  const reach = Math.max(...Object.values(PLACE_RADIUS)) * 1.6 + 300
  const near = (pts: [number, number][]) => pts.some(([x, y]) => Math.abs(x) < reach && Math.abs(y) < reach)
  for (const [, , , ring] of district.buildings ?? []) {
    const pts = ring.map(f.to)
    if (near(pts)) g.addBox(boxOf(pts, 6))
  }
  for (const [cls, , , line] of district.roads ?? []) {
    const pts = line.map(f.to)
    if (!near(pts)) continue
    for (let i = 1; i < pts.length; i++) g.addSeg([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], (ROAD_HALF[cls] ?? 6) + 3])
  }
  g.addBox(boxOf(project.site.map(f.to), 12))
  for (const b of project.buildings) g.addBox(boxOf(b.footprint.map(f.to), 6))
  const as = areas(district, f, reach)
  for (const a of as) for (let i = 1; i < a.pts.length; i++) g.addSeg([a.pts[i - 1][0], a.pts[i - 1][1], a.pts[i][0], a.pts[i][1], 4])

  return facilities.map(fac => {
    const area = plotArea(fac.kind, fac.amount)
    const a = ASPECT[fac.kind]
    const w0 = Math.sqrt(area * a), d0 = area / w0
    const R = PLACE_RADIUS[fac.kind]
    let found: { x: number; y: number; w: number; d: number; r: number } | null = null
    // кольца от ближнего к дальнему, шаг 15 м; дальше радиуса — запасной вариант с флагом
    for (let r = 0; r <= R * 1.6 && !found; r += 15) {
      const n = Math.max(1, Math.round((2 * Math.PI * r) / 15))
      for (let i = 0; i < n && !found; i++) {
        const t = (i / n) * 2 * Math.PI - Math.PI / 2 // начинаем с юга: на севере обычно ЖК и его двор
        const x = r * Math.cos(t), y = r * Math.sin(t)
        for (const [w, d] of [[w0, d0], [d0, w0]]) {
          const b: Box = [x - w / 2, y - d / 2, x + w / 2, y + d / 2]
          if (g.free(b) && !inArea(as, x, y)) { found = { x, y, w, d, r }; g.addBox([b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8]); break }
        }
      }
    }
    const p = found ?? { x: 0, y: -R, w: w0, d: d0, r: R }
    return { ...fac, center: f.from(p.x, p.y), w: p.w, d: p.d, plotArea: Math.round(area), dist: Math.round(p.r), inRadius: !!found && p.r <= R, found: !!found }
  })
}

/** Прямоугольник в метрах вокруг точки — для моделей зданий. */
export function rectAround(c: LngLat, x0: number, y0: number, x1: number, y1: number): LngLat[] {
  const f = frame(c)
  return [f.from(x0, y0), f.from(x1, y0), f.from(x1, y1), f.from(x0, y1), f.from(x0, y0)]
}
export function ringAround(c: LngLat, cx: number, cy: number, rx: number, ry: number, steps = 32): LngLat[] {
  const f = frame(c)
  const pts = Array.from({ length: steps }, (_, i) => { const t = (i / steps) * 2 * Math.PI; return f.from(cx + rx * Math.cos(t), cy + ry * Math.sin(t)) })
  return [...pts, pts[0]]
}

/** Проверка для тестов: пересекает ли участок здания или дороги района. */
export function overlaps(district: District, p: Placed) {
  const f = frame(p.center)
  const b: Box = [-p.w / 2, -p.d / 2, p.w / 2, p.d / 2]
  for (const [, , , ring] of district.buildings ?? []) if (hit(boxOf(ring.map(f.to), 0), b)) return 'здание'
  const as = areas(district, f, 3000)
  if (inArea(as, 0, 0)) return 'вода или парк'
  for (const a of as) for (let i = 1; i < a.pts.length; i++) if (segHit([a.pts[i - 1][0], a.pts[i - 1][1], a.pts[i][0], a.pts[i][1], 0], b)) return 'вода или парк'
  for (const [cls, , , line] of district.roads ?? []) {
    const pts = line.map(f.to)
    for (let i = 1; i < pts.length; i++) if (segHit([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], ROAD_HALF[cls] ?? 6], b)) return 'дорога'
  }
  return null
}

/** Участок ЖК задевает дорогу или существующие здания — предупреждение пользователю (передвинуть участок). */
export function siteConflict(district: District, project: Project): string | null {
  const f = frame(centroid(project.site))
  const b = boxOf(project.site.map(f.to), 0)
  for (const [cls, , , line] of district.roads ?? []) {
    const pts = line.map(f.to)
    for (let i = 1; i < pts.length; i++) if (segHit([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], ROAD_HALF[cls] ?? 6], b)) return 'дорогу'
  }
  for (const [, , , ring] of district.buildings ?? []) {
    const [x, y] = f.to(centroid(ring))
    if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return 'существующие здания'
  }
  const as = areas(district, f, 3000)
  const hitArea = inArea(as, 0, 0) ?? as.find(a => a.pts.some(([x, y]) => x > b[0] && x < b[2] && y > b[1] && y < b[3]))
  if (hitArea) return hitArea.kind === 'water' ? 'воду' : 'парк или лес'
  return null
}
