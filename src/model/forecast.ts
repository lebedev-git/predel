import { distance, type LngLat } from './geo'
import { cohort } from './model'

/* Прогноз учеников по школам — три блока:
 *  1. Сколько детей живёт в доме: квартиры × заселено × учеников на квартиру по возрасту дома × поправка на рождения.
 *  2. В какую школу пойдут: модель Хаффа. Школа тянет детей тем сильнее, чем она ближе, если дом за ней закреплён,
 *     если это гимназия или лицей. Доля дома в школе = её притяжение / сумма притяжений открытых школ.
 *  3. Хватит ли мест: ученики против проектной мощности — одна смена, две смены, за пределом двух смен.
 * Параметры блоков 1 и 2 подбираются по числу учеников в школах (calibrate) — адреса учеников не нужны.
 * Проверка метода — синтетический город в forecast.test.ts: заданные параметры восстанавливаются. */

/** Дом: год сдачи, квартиры; school — id школы, за которой дом закреплён; prev — прежняя школа закрепления,
 *  действует, пока school не открыта (дома новой гимназии № 107 до 2023 г. были закреплены за школой № 143). */
export interface House { id: string; coords: LngLat; flats: number; year: number; school?: string; prev?: string }
/** Школа: design — проектная мощность на одну смену; magnet — гимназия или лицей. */
export interface School { id: string; name?: string; coords: LngLat; openYear: number; design?: number; magnet?: boolean }
export interface Params {
  kpf: number[] // учеников на квартиру по возрасту дома (лет после сдачи): 0–2, 3–5, 6–9, 10–14, 15+
  pace: number[] // доля заселённых квартир: год сдачи, через год, через два, дальше
  beta: number // затухание притяжения с расстоянием, 1/км
  gamma: number // бонус закрепления
  alpha: number // бонус гимназии или лицея
}
/** Ученики по годам: id школы → год → число. */
export type Observed = Record<string, Record<number, number>>
export interface Options {
  ages?: [number, number] // возраст детей для поправки на рождения: школа 7–17, сад 1–6
  refYear?: number // kpf — при рождаемости этого года
}

export const AGE_STEPS = ['0–2', '3–5', '6–9', '10–14', '15+']
const ageStep = (a: number) => (a < 3 ? 0 : a < 6 ? 1 : a < 10 ? 2 : a < 15 ? 3 : 4)

/** До калибровки: уровень Казани 0,327 ученика на квартиру (дети 7–17, Татарстанстат на 01.01.2024 / квартиры OSM × 0,96)
 *  × форма волны FolgekostenSchätzer по ступеням; заселение — допущение; Хафф — почти все идут по закреплению. */
export const DEFAULT_PARAMS: Params = {
  kpf: [0.21, 0.225, 0.266, 0.316, 0.327],
  pace: [0.5, 0.8, 0.95, 1],
  beta: 1,
  gamma: 3,
  alpha: 0,
}

/** Подбор на Азино (Советский район: 39 школ, в 2017–2020 шесть новых, после 2010 сдано 43 тыс. квартир), годы 2018–2021,
 *  03.11.2026, azino.test.ts. Волна Казани: в первые годы дома 0,9 от зрелого уровня, пик в 1,4 раза выше — на 10–14-м году
 *  (немецкая форма до подбора: 0,64 → 1,0). По школам точнее DEFAULT_PARAMS, но сумму по городу занижает на 5–7%. */
export const AZINO_PARAMS: Params = { ...DEFAULT_PARAMS, kpf: [0.207, 0.227, 0.271, 0.341, 0.238], beta: 0.6, gamma: 0.99, alpha: 0.04 }

/** Блок 1. Учеников из дома в году y (cf — поправка на рождения к refYear). */
export function houseKids(h: House, y: number, p: Params, cf = 1) {
  const a = y - h.year
  return a < 0 ? 0 : h.flats * p.pace[Math.min(a, p.pace.length - 1)] * p.kpf[ageStep(a)] * cf
}

export function birthFactor(y: number, o: Options = {}) {
  const [a, b] = o.ages ?? [7, 17], ref = o.refYear ?? 2026
  return cohort(y, a, b) / cohort(ref, a, b)
}

/** Расстояния дом → школа, км: считаются один раз на набор домов и школ. */
export function prepare(houses: House[], schools: School[]) {
  const ix = new Map(schools.map((s, j) => [s.id, j]))
  const at = (id?: string) => (id === undefined ? -1 : (ix.get(id) ?? -1))
  return {
    houses, schools,
    km: houses.map(h => schools.map(s => distance(h.coords, s.coords) / 1000)),
    assigned: houses.map(h => at(h.school)),
    prev: houses.map(h => at(h.prev)),
  }
}
type Prepared = ReturnType<typeof prepare>

/** Блок 2. Притяжение школы j для дома i без бонуса закрепления; бонус e^γ — множитель школы закрепления года. */
function pull(P: Prepared, p: Params) {
  return P.km.map(row => row.map((d, j) => Math.exp(-p.beta * d + (P.schools[j].magnet ? p.alpha : 0))))
}

/** Блоки 1 + 2: ожидаемые ученики [школа][год] по модели, без привязки к факту. */
export function expected(P: Prepared, p: Params, years: number[], o: Options = {}) {
  const W = pull(P, p), bonus = Math.exp(p.gamma)
  const out = P.schools.map(() => years.map(() => 0))
  years.forEach((y, t) => {
    const cf = birthFactor(y, o)
    const open = P.schools.map(s => s.openYear <= y)
    P.houses.forEach((h, i) => {
      const g = houseKids(h, y, p, cf)
      if (!g) return
      const a = P.assigned[i] >= 0 && open[P.assigned[i]] ? P.assigned[i] : P.prev[i] >= 0 && open[P.prev[i]] ? P.prev[i] : -1
      const w = (j: number) => (open[j] ? W[i][j] * (j === a ? bonus : 1) : 0)
      let sum = 0
      for (let j = 0; j < open.length; j++) sum += w(j)
      if (!sum) return
      for (let j = 0; j < open.length; j++) out[j][t] += (g * w(j)) / sum
    })
  })
  return out
}

export type Shift = 'одна смена' | 'две смены' | 'за пределом' | 'нет данных'
/** Блок 3. По СанПиН две смены можно, три нельзя: потолок — две проектные мощности. */
export const shiftOf = (pupils: number, design?: number): Shift =>
  !design ? 'нет данных' : pupils <= design ? 'одна смена' : pupils <= 2 * design ? 'две смены' : 'за пределом'

export interface SchoolForecast {
  id: string
  pupils: number[] // по годам years
  shift: Shift[]
  secondShiftYear?: number // первый год, когда учеников больше проектной мощности
  overLimitYear?: number // первый год за пределом двух смен
}

/** Прогноз по школам. С фактом за годы привязки к модели добавляется поправка школы — средняя разница «факт − модель»
 *  за эти годы: систематическая ошибка по школе (недосчитанные квартиры, своё закрепление) не переходит в прогноз,
 *  а шум одного года усредняется. Привязка к одному году переносит его шум во все годы прогноза — на синтетике это
 *  +1–2 п. п. ошибки по школе. Школы без факта — по модели целиком. */
export function forecast(P: Prepared, p: Params, years: number[], o: Options & { observed?: Observed; anchorYears?: number[] } = {}): SchoolForecast[] {
  const ay = o.anchorYears ?? []
  const raw = expected(P, p, [...years, ...ay], o)
  return P.schools.map((s, j) => {
    const diffs = ay.flatMap((y, k) => {
      const v = o.observed?.[s.id]?.[y]
      return v === undefined ? [] : [v - raw[j][years.length + k]]
    })
    const offset = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0
    const pupils = years.map((_, t) => Math.max(0, raw[j][t] + offset))
    const shift = pupils.map(x => shiftOf(x, s.design))
    const first = (k: Shift[]) => years.find((_, t) => k.includes(shift[t]))
    return { id: s.id, pupils, shift, secondShiftYear: first(['две смены', 'за пределом']), overLimitYear: first(['за пределом']) }
  })
}

// ---------- Подбор параметров ----------

/** Нелдер — Мид: минимум функции без производных. */
export function nelderMead(f: (x: number[]) => number, x0: number[], iters = 4000, step = 0.3) {
  const n = x0.length
  let pts = [x0, ...x0.map((_, i) => x0.map((v, k) => (i === k ? v + step : v)))].map(x => ({ x, f: f(x) }))
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f)
    if (pts[n].f - pts[0].f < 1e-10 * (1 + Math.abs(pts[0].f))) break
    const c = x0.map((_, k) => pts.slice(0, n).reduce((s, q) => s + q.x[k], 0) / n)
    const at = (t: number) => c.map((v, k) => v + t * (pts[n].x[k] - v))
    const r = at(-1), fr = f(r)
    if (fr < pts[0].f) {
      const e = at(-2), fe = f(e)
      pts[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }
    } else if (fr < pts[n - 1].f) pts[n] = { x: r, f: fr }
    else {
      const cx = at(fr < pts[n].f ? -0.5 : 0.5), fc = f(cx)
      if (fc < Math.min(fr, pts[n].f)) pts[n] = { x: cx, f: fc }
      else pts = pts.map((q, i) => (i === 0 ? q : ((x: number[]) => ({ x, f: f(x) }))(q.x.map((v, k) => pts[0].x[k] + 0.5 * (v - pts[0].x[k])))))
    }
  }
  return pts.sort((a, b) => a.f - b.f)[0]
}

/** Подбирает учеников на квартиру по возрасту дома и три ручки Хаффа так, чтобы модель повторяла факт по школам
 *  в годах fitYears. Темп заселения не подбирается (берётся из start): по одним итогам школ он неотличим от kpf первых лет.
 *  Параметры определяются, только если в годах подбора есть события: новые дома разного возраста, открытие школы.
 *  Ново-Савиновский 2020–2023 таких событий не содержит — подбор там вырождается (nsav.test.ts). */
export function calibrate(P: Prepared, observed: Observed, fitYears: number[], start: Params = DEFAULT_PARAMS, o: Options = {}) {
  const cells = P.schools.flatMap((s, j) => fitYears.map((y, t) => ({ j, t, v: observed[s.id]?.[y] }))).filter(c => c.v !== undefined && P.schools[c.j].openYear <= fitYears[c.t]) as { j: number; t: number; v: number }[]
  const toParams = (x: number[]): Params => ({ ...start, kpf: x.slice(0, 5).map(Math.exp), alpha: x[5], beta: Math.exp(x[6]), gamma: x[7] })
  // отклонение в долях пуассоновского шума: большая школа не перевешивает маленькую
  const misfit = (x: number[]) => {
    const m = expected(P, toParams(x), fitYears, o)
    return cells.reduce((s, c) => s + (m[c.j][c.t] - c.v) ** 2 / Math.max(c.v, 1), 0)
  }
  // привязка к исходным значениям (априорное распределение): параметр уходит от start, только если данные настаивают.
  // Без неё на неполных данных подбор вырождается (Азино: «0 учеников в старых домах, 2,2 — в домах 10–14 лет»).
  // Разброс: учеников на квартиру — в 1,5 раза (ln 0,4), α — 0,5, β — в 1,6 раза, γ — 1. Вес данных — поделён на
  // избыточный разброс при исходных значениях (квазипуассон), чтобы неучтённые эффекты не выдавали себя за точность.
  const x0 = [...start.kpf.map(Math.log), start.alpha, Math.log(start.beta), start.gamma]
  const sd = [0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.5, 1]
  const phi = Math.max(1, misfit(x0) / cells.length)
  const loss = (x: number[]) => misfit(x) / phi + x.reduce((s, v, i) => s + ((v - x0[i]) / sd[i]) ** 2, 0)
  let best = nelderMead(loss, x0)
  best = nelderMead(loss, best.x) // перезапуск: симплекс Нелдера — Мида иногда залипает
  return { params: toParams(best.x), loss: best.f, cells: cells.length, phi }
}
