import { DEFAULT_COEFS } from './coefficients'
import { ageStep, birthFactor, expected, forecast, houseKids, prepare, shiftOf, type House, type Observed, type Params, type School, type Shift } from './forecast'
import { distance, type LngLat } from './geo'

/* Калькулятор нового ЖК на ядре прогноза (forecast.ts). Очередь ЖК — дом в точке участка: её детей считает тот же
 * блок 1, по школам раскладывает тот же блок 2 (закрепление за ближайшей школой + притяжение по Хаффу).
 * Загрузка школы = прогноз без ЖК (привязан к факту) + дети ЖК + перетоки к своей школе ЖК, если она есть.
 * «Не хватает мест» — на сколько из-за ЖК выросло число детей сверх проектной мощности школ (то есть во второй смене
 * и дальше). Школы без мощности в этот счёт не входят: их дети ЖК показаны отдельно. */

export const SCHOOL_PER_10K = DEFAULT_COEFS.schoolPer10k.value // 47 мест на 10 тыс. м² квартир, МНГП Казани
export type Cap = 'точно' | 'оценка' | 'демо' | 'нет данных'
export interface CitySchool extends School { cap: Cap; capRange?: [number, number] }
export interface Phase { year: number; flats: number }
/** area — средняя площадь квартиры, м²; own — своя школа ЖК (мест, год открытия). */
export interface Complex { coords: LngLat; phases: Phase[]; area: number; own?: { design: number; year: number } }
export interface City { schools: CitySchool[]; houses: House[]; years: number[]; base: number[][] }

/** Город для калькулятора: прогноз по школам без ЖК, привязанный к факту за anchorYears. */
export function cityBase(houses: House[], schools: CitySchool[], observed: Observed, p: Params, years: number[], anchorYears: number[]): City {
  return { schools, houses, years, base: forecast(prepare(houses, schools), p, years, { observed, anchorYears }).map(f => f.pupils) }
}

const OWN = 'own'
const LOCAL_KM = 5 // своя школа ЖК перетягивает детей соседних домов; дальше 5 км её притяжение меньше 1%

/** Очереди ЖК как дома. Закрепление — ближайшая школа, открытая к сдаче первой очереди; со своей школой — она,
 *  а до её открытия ближайшая (как дома гимназии № 107 до 2023 г. за школой № 143). */
export function complexHouses(z: Complex, schools: School[]): House[] {
  const first = Math.min(...z.phases.map(p => p.year))
  const open = schools.filter(s => s.openYear <= first)
  const near = (open.length ? open : schools).reduce((b, s) => (distance(s.coords, z.coords) < distance(b.coords, z.coords) ? s : b)).id
  return z.phases.map((ph, i) => ({ id: `zhk${i}`, coords: z.coords, flats: ph.flats, year: ph.year, school: z.own ? OWN : near, prev: z.own ? near : undefined }))
}

/** Формула по шагам для года y: по каждой очереди квартиры × заселено × учеников на квартиру × поправка на рождения. */
export function steps(z: Complex, p: Params, y: number) {
  const cf = birthFactor(y)
  return z.phases.map((ph, i) => {
    const a = y - ph.year
    return { ...ph, age: a, settled: a < 0 ? 0 : p.pace[Math.min(a, p.pace.length - 1)], kpf: a < 0 ? 0 : p.kpf[ageStep(a)], cf,
      kids: houseKids({ id: `zhk${i}`, coords: z.coords, flats: ph.flats, year: ph.year }, y, p, cf) }
  })
}

export interface SchoolRow {
  id: string; name: string; design?: number; cap: Cap; capRange?: [number, number]
  base: number[]; load: number[]; fromZhk: number[]; shiftBase: Shift[]; shift: Shift[]
  share: number // доля детей ЖК за все годы
}

export function calcComplex(c: City, z: Complex, p: Params) {
  const own: CitySchool | null = z.own ? { id: OWN, name: 'Своя школа ЖК', coords: z.coords, openYear: z.own.year, design: z.own.design, cap: 'точно' } : null
  const schools = own ? [...c.schools, own] : c.schools
  const T = c.years.map((_, t) => t)
  const zh = expected(prepare(complexHouses(z, c.schools), schools), p, c.years)
  // своя школа меняет и выбор соседних домов: разница «со школой − без» по домам в 5 км
  let delta: number[][] | null = null
  if (own) {
    const local = c.houses.filter(h => distance(h.coords, z.coords) < LOCAL_KM * 1000)
    const a = expected(prepare(local, schools), p, c.years), b = expected(prepare(local, c.schools), p, c.years)
    delta = a.map((r, j) => r.map((v, t) => v - (b[j]?.[t] ?? 0)))
  }
  const total = zh.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) || 1
  const rows: SchoolRow[] = schools.map((s, j) => {
    const base = c.base[j] ?? T.map(() => 0)
    const load = T.map(t => Math.max(0, base[t] + (delta?.[j][t] ?? 0) + zh[j][t]))
    return { id: s.id, name: s.name ?? s.id, design: s.design, cap: (s as CitySchool).cap, capRange: (s as CitySchool).capRange, base, load, fromZhk: zh[j],
      shiftBase: base.map(x => shiftOf(x, s.design)), shift: load.map(x => shiftOf(x, s.design)), share: zh[j].reduce((a, b) => a + b, 0) / total }
  })
  const over = (x: number, d?: number) => (d ? Math.max(0, x - d) : 0)
  return {
    years: c.years,
    kids: T.map(t => zh.reduce((s, r) => s + r[t], 0)),
    norm: c.years.map(y => (z.phases.filter(ph => ph.year <= y).reduce((s, ph) => s + ph.flats, 0) * z.area * SCHOOL_PER_10K) / 1e4),
    extra: T.map(t => rows.reduce((s, r) => s + over(r.load[t], r.design) - over(r.base[t], r.design), 0)),
    unknown: T.map(t => rows.reduce((s, r) => s + (r.design ? 0 : r.fromZhk[t]), 0)),
    schools: rows.sort((a, b) => b.share - a.share),
  }
}
export type CalcResult = ReturnType<typeof calcComplex>

/** Мощности из таблицы школ (kazan-schools.json) — к школам модели (kazan-forecast.json): номер школы + не дальше 1 км. */
export interface CapRow { name: string; coords: LngLat; capacity: number | null; capLo: number | null; capHi: number | null; capSource: string }
export function joinCapacity(schools: School[], table: CapRow[]): CitySchool[] {
  const num = (s: string) => s.match(/№\s*(\d+)/)?.[1]
  return schools.map(s => {
    const r = table.filter(t => num(t.name) === num(s.name ?? '') && distance(t.coords, s.coords) < 1000)
      .sort((a, b) => distance(a.coords, s.coords) - distance(b.coords, s.coords))[0]
    if (!r?.capacity) return { ...s, design: undefined, cap: 'нет данных' }
    const exact = r.capSource !== 'оценка по площади'
    return { ...s, design: r.capacity, cap: exact ? 'точно' : 'оценка', capRange: exact ? undefined : [r.capLo!, r.capHi!] }
  })
}
