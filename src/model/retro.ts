import { DEMOGRAPHY, PACE, WAVE, type Coefs } from './coefficients'
import { centroid, distance, type LngLat } from './geo'
import type { District, DistrictObject, Step } from './model'

// Проверка прогноза на построенных ЖК: модель считает детей во всех домах зоны по году ввода и числу квартир (OSM)
// и сравнивает с фактическим контингентом школ и садов той же зоны (edu.tatar.ru). Балансовая проверка: допускаем,
// что дети зоны учатся в её школах, а приток и отток уравновешены — это допущение, оно подписано в интерфейсе.

// 500 м — радиус доступности школ и садов по МНГП Казани (табл. 5.1.1.1.1). При 800 м (радиус стеснённой застройки)
// Азино давало +3% по школам, но 800 м — подобранная величина, а не норматив
export const RETRO_RADIUS = 500
export const NEW_FROM = 2010 // дома моложе — новый фонд: типовой состав семей и волна заселения; старше — зрелый фонд Казани
const HOUSE_RESIDENTS = 3 // частный дом без числа квартир — одна семья (допущение)

const CENTERS = new WeakMap<District, LngLat[]>()
const centers = (d: District) => CENTERS.get(d) ?? (CENTERS.set(d, (d.buildings ?? []).map(b => centroid(b[3]))), CENTERS.get(d)!)

/** Построенный ЖК: жилые дома того же года ввода (±1), связанные цепочкой не длиннее 120 м между соседями. */
export function clusterOf(d: District, seed: number): number[] {
  const bs = d.buildings ?? []
  const s = bs[seed]
  if (!s || s[0] !== 'res') return []
  const y0 = s[4] ?? 0
  if (!y0) return [seed]
  const cs = centers(d)
  const c0 = cs[seed]
  const cand = bs.map((b, i) => ({ i, c: cs[i], b })).filter(x => x.b[0] === 'res' && x.b[2] > 0 && Math.abs((x.b[4] ?? 0) - y0) <= 1 && distance(x.c, c0) < 1200)
  const seen = new Set([seed]), queue = [cand.find(x => x.i === seed) ?? { i: seed, c: c0, b: s }]
  while (queue.length) {
    const cur = queue.pop()!
    for (const x of cand) if (!seen.has(x.i) && distance(x.c, cur.c) < 120) { seen.add(x.i); queue.push(x) }
  }
  return [...seen]
}

export interface RetroSide { pred: number; fact: number; n: number; missing: number; own: number; steps: Step[]; objects: DistrictObject[] }
export interface Retro {
  center: LngLat
  year: number // год проверки — дата данных о контингенте
  built: [number, number] // годы ввода ЖК
  flats: number
  residents: number
  school: RetroSide
  kg: RetroSide
}

/** Дети в доме к году y: новый фонд — пресет «Типовой» × темп заселения × волна по годам с ввода; старый — «Зрелый фонд Казани». */
function kids(b: [string, number, number, LngLat[], number?], y: number, occ: number, preset: keyof typeof DEMOGRAPHY) {
  const built = b[4] ?? 0
  if (built > y) return null
  const res = b[0] === 'house' ? HOUSE_RESIDENTS : b[2] * occ
  const t = y - built
  if (built >= NEW_FROM) {
    const p = DEMOGRAPHY[preset], pace = PACE.base.pace[Math.min(t, PACE.base.pace.length - 1)]
    const w = (c: number[]) => c[Math.min(t, c.length - 1)]
    return { res: res * pace, k06: res * pace * p.share0to6 * w(WAVE.preschool),
      k715: res * pace * p.share7to15 * ((4 / 9) * w(WAVE.primary) + (5 / 9) * w(WAVE.secondary)), k1617: res * pace * p.share16to17 * w(WAVE.secondary) }
  }
  const p = DEMOGRAPHY.kazan
  return { res, k06: res * p.share0to6, k715: res * p.share7to15, k1617: res * p.share16to17 }
}

export function retroCheck(d: District, cluster: number[], coefs: Coefs, radius = RETRO_RADIUS, preset: keyof typeof DEMOGRAPHY = 'tz', atYear?: number): Retro | null {
  const bs = d.buildings ?? []
  if (!cluster.length) return null
  const y = atYear ?? Number(d.dataDate.slice(0, 4)) // год прогноза; факт о контингенте — только на дату данных
  const cs = centers(d)
  const center = centroid(cluster.map(i => cs[i]))
  const occ = coefs.occupancy.value, kgCov = coefs.kgCoverage.value, lo = coefs.schoolCoverageLow.value, hi = coefs.schoolCoverageHigh.value
  const own = new Set(cluster)
  let flats = 0, houses = 0, resZone = 0, k06 = 0, school = 0, ownKg = 0, ownSchool = 0, ownRes = 0, newFlats = 0
  bs.forEach((b, i) => {
    if (!(b[0] === 'house' || (b[0] === 'res' && b[2] > 0))) return
    if (distance(cs[i], center) > radius) return
    const k = kids(b, y, occ, preset)
    if (!k) return
    if (b[0] === 'house') houses++; else flats += b[2]
    if ((b[4] ?? 0) >= NEW_FROM) newFlats += b[2]
    resZone += k.res
    const kg = k.k06 * kgCov, sc = k.k715 * lo + k.k1617 * hi
    k06 += kg; school += sc
    if (own.has(i)) { ownKg += kg; ownSchool += sc; ownRes += k.res }
  })
  const side = (kind: 'school' | 'kindergarten', pred: number, ownPart: number): RetroSide => {
    const objs = d.objects.filter(o => o.kind === kind && distance(o.coords, center) <= radius)
    const withFact = objs.filter(o => o.load !== undefined && o.info?.load?.status === 'факт')
    const fact = withFact.reduce((a, o) => a + o.load!, 0)
    const noun = kind === 'school' ? 'школьники 7–17 лет' : 'дети в садах (1–6 лет × 85%)'
    const isFact = y === Number(d.dataDate.slice(0, 4))
    return { pred, fact, n: withFact.length, missing: objs.length - withFact.length, own: ownPart, objects: withFact,
      steps: [
        { label: `Квартир в домах в ${radius} м${houses ? ` и ${houses} частных домов` : ''}`, value: flats + houses, unit: 'кв.', src: `OpenStreetMap, из них новых (с ${NEW_FROM} г.): ${newFlats.toLocaleString('ru-RU')}` },
        { label: `× ${occ.toLocaleString('ru-RU')} жителя на квартиру, с темпом заселения новых домов`, value: resZone, unit: 'жит.', src: 'коэффициент заселения' },
        { label: `→ ${noun}: новые дома — типовой состав и волна по годам с ввода, старые — зрелый фонд Казани`, value: pred, unit: 'детей', src: 'пресеты «Типовой» и «Зрелый фонд Казани», DfE 2023' },
        ...(!isFact ? [] : [{ label: `фактически в ${withFact.length} ${kind === 'school' ? (withFact.length === 1 ? 'школе' : 'школах') : withFact.length === 1 ? 'саду' : 'садах'} зоны`, value: fact, unit: 'детей', src: `edu.tatar.ru, ${d.dataDate}` },
        { label: '= расхождение прогноза с фактом', value: fact ? ((pred - fact) / fact) * 100 : 0, unit: '%' }]),
      ] }
  }
  const years = cluster.map(i => bs[i][4] ?? 0).filter(Boolean)
  return {
    center, year: y, built: [Math.min(...years), Math.max(...years)], flats: cluster.reduce((a, i) => a + bs[i][2], 0), residents: ownRes,
    school: side('school', school, ownSchool), kg: side('kindergarten', k06, ownKg),
  }
}

/** Пример для показа: самый крупный новый ЖК, у которого факт о контингенте есть у всех школ зоны (иначе сравнение ненадёжно). */
export function bestSeed(d: District, coefs?: Coefs): number | null {
  const bs = d.buildings ?? []
  const seeds = bs.map((b, i) => ({ b, i })).filter(x => x.b[0] === 'res' && (x.b[4] ?? 0) >= 2012 && (x.b[4] ?? 0) <= 2020 && x.b[2] >= 150)
    .sort((a, b) => b.b[2] - a.b[2]).slice(0, 40)
  let best: { i: number; flats: number; full: number } | null = null
  const seen = new Set<number>()
  for (const s of seeds) {
    if (seen.has(s.i)) continue
    const cl = clusterOf(d, s.i)
    cl.forEach(j => seen.add(j))
    const r = coefs ? retroCheck(d, cl, coefs) : null
    const full = r ? Number(r.school.missing === 0 && r.school.fact > 300) * 2 + Number(r.kg.missing === 0 && r.kg.fact > 100) : 0
    const flats = cl.reduce((a, i) => a + bs[i][2], 0)
    if (!best || full > best.full || (full === best.full && flats > best.flats)) best = { i: s.i, flats, full }
  }
  return best?.i ?? null
}

export interface RetroSummary { zones: number; total: number; median: number; typical: number; schools: number; withFact: number; kgZones: number; kgTotal: number }
/** Все новые ЖК района (с 2010 г., от 100 квартир): расхождение по школам там, где факт есть у всех школ зоны. */
export function retroSummary(d: District, coefs: Coefs): RetroSummary {
  const seen = new Set<number>(), es: number[] = []
  let p = 0, f = 0, kp = 0, kf = 0, kz = 0
  ;(d.buildings ?? []).forEach((b, i) => {
    if (b[0] !== 'res' || (b[4] ?? 0) < NEW_FROM || b[2] < 100 || seen.has(i)) return
    const cl = clusterOf(d, i)
    cl.forEach(j => seen.add(j))
    const x = retroCheck(d, cl, coefs)
    if (x && x.kg.fact > 100 && !x.kg.missing) { kp += x.kg.pred; kf += x.kg.fact; kz++ }
    if (!x || x.school.fact < 300 || x.school.missing) return
    es.push((x.school.pred - x.school.fact) / x.school.fact)
    p += x.school.pred; f += x.school.fact
  })
  const sorted = [...es].sort((a, b) => a - b)
  const sch = d.objects.filter(o => o.kind === 'school')
  return { zones: es.length, total: f ? (p - f) / f : 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    typical: es.reduce((a, x) => a + Math.abs(x), 0) / Math.max(1, es.length),
    schools: sch.length, withFact: sch.filter(o => o.info?.load?.status === 'факт').length, kgZones: kz, kgTotal: kf ? (kp - kf) / kf : 0 }
}

export interface RetroPoint { year: number; school: number; kg: number; ownSchool: number; ownKg: number; residents: number }
/** Прогноз по годам для зоны построенного ЖК: от двух лет до ввода до +10 лет от даты данных (дома, построенные позже, не входят). */
export function retroSeries(d: District, cluster: number[], coefs: Coefs, from: number, to: number): RetroPoint[] {
  const out: RetroPoint[] = []
  for (let y = from; y <= to; y++) {
    const r = retroCheck(d, cluster, coefs, RETRO_RADIUS, 'tz', y)
    if (r) out.push({ year: y, school: r.school.pred, kg: r.kg.pred, ownSchool: r.school.own, ownKg: r.kg.own, residents: r.residents })
  }
  return out
}
