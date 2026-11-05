import { expected, prepare, type House, type Observed, type Params, type School } from './forecast'
import type { LngLat } from './geo'

/* Демо-город: истина задана заранее (TRUE), «факт» учеников по школам 2016–2026 сгенерирован по ней с шумом отчётности.
 * Модель видит то же, что в Казани: дома, школы, закрепление и число учеников по годам. На нём проверяется метод
 * (forecast.test.ts: подбор возвращает заложенные параметры) и работает калькулятор там, где у Казани нет данных. */

export const TRUE: Params = { kpf: [0.165, 0.24, 0.33, 0.345, 0.3], pace: [0.4, 0.75, 0.95, 1], beta: 1, gamma: 1.5, alpha: 0.8 }
export const DEMO_YEARS = Array.from({ length: 11 }, (_, i) => 2016 + i)

export const at = (xKm: number, yKm: number): LngLat => [49.1 + xKm / 62.6, 55.75 + yKm / 111.2] // км → градусы у Казани

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Город 8×8 км: 16 старых школ (2 гимназии), 3 новых квартала со своей школой; школа третьего — гимназия, как № 107.
 *  Проектная мощность — демо: пик учеников по истине × 0,75 / 1,0 / 1,3 по кругу, чтобы в городе были все три состояния. */
export function demoCity(seed = 1) {
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a))
  const xy: [number, number][] = [1, 3, 5, 7].flatMap(x => [1, 3, 5, 7].map(y => [x + 0.3 * gauss(), y + 0.3 * gauss()] as [number, number]))
  const centers: [number, number][] = [[7.8, 7.8], [0.2, 7.8], [7.8, 0.2]]
  const magnet = [5, 10, 18]
  const schools: School[] = [...xy, ...centers].map((p, j) => ({
    id: `s${j}`, name: `${magnet.includes(j) ? 'Гимназия' : 'Школа'} № ${j + 1}`, coords: at(...p), openYear: [2014, 2019, 2023][j - 16] ?? 1960, magnet: magnet.includes(j),
  }))
  const raw: { x: number; y: number; flats: number; year: number }[] = []
  for (let i = 0; i < 300; i++) raw.push({ x: 8 * r(), y: 8 * r(), flats: int(40, 250), year: int(1960, 2006) })
  const eras = [[2008, 2017], [2014, 2023], [2019, 2027]]
  centers.forEach(([cx, cy], k) => { for (let i = 0; i < 40; i++) raw.push({ x: cx + 0.5 * gauss(), y: cy + 0.5 * gauss(), flats: int(150, 500), year: int(eras[k][0], eras[k][1]) }) })
  const all = [...xy, ...centers]
  const houses: House[] = raw.map((h, i) => {
    const near = all.reduce((b, p, j) => (Math.hypot(p[0] - h.x, p[1] - h.y) < Math.hypot(all[b][0] - h.x, all[b][1] - h.y) ? j : b), 0)
    // закрепление — ближайшая школа; пока она не открыта — ближайшая из старых (как дома № 107 до 2023 г. за школой № 143)
    const old = xy.reduce((b, p, j) => (Math.hypot(p[0] - h.x, p[1] - h.y) < Math.hypot(xy[b][0] - h.x, xy[b][1] - h.y) ? j : b), 0)
    return { id: `h${i}`, coords: at(h.x, h.y), flats: h.flats, year: h.year, school: `s${near}`, prev: near >= 16 ? `s${old}` : undefined }
  })
  const P = prepare(houses, schools)
  const truth = expected(P, TRUE, DEMO_YEARS)
  const observed: Observed = {}
  schools.forEach((s, j) => {
    s.design = Math.round((Math.max(...truth[j]) * [0.75, 1, 1.3][j % 3]) / 25) * 25
    observed[s.id] = {}
    DEMO_YEARS.forEach((y, t) => {
      if (s.openYear > y) return
      const m = truth[j][t] // шум: пуассоновский + 3% ошибки отчётности
      observed[s.id][y] = Math.max(0, Math.round((m + Math.sqrt(m) * gauss()) * (1 + 0.03 * gauss())))
    })
  })
  return { P, houses, schools, observed }
}

/** Параметры, подобранные на демо-городе по его «факту» 2016–2026 (calibrate, 05.11.2026): модель не знает TRUE,
 *  а восстанавливает её с точностью 1–6% по ступеням. Калькулятор в режиме «демо-город» считает на них. */
export const DEMO_FIT: Params = { kpf: [0.169, 0.236, 0.33, 0.347, 0.297], pace: [0.5, 0.8, 0.95, 1], beta: 0.942, gamma: 1.575, alpha: 0.8 }
