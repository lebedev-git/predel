import { BIRTHS, BIRTHS_SOURCE, DEFAULT_COEFS, PACE, POWER_TABLE, WAVE, type CoefKey, type Coefs } from './coefficients'
import { centroid, distance, type LngLat } from './geo'

// Расчётное ядро: чистые функции без интерфейса — можно вызвать из цифрового двойника, сервера или теста.
// Методика и источники — docs/МЕТОДИКА.md.

// ---------- Входные данные ----------

export type ObjKind = 'kindergarten' | 'school' | 'shop' | 'pharmacy' | 'stop' | 'parking' | 'intersection' | 'clinic' | 'sport' | 'metro'
export type DataStatus = 'факт' | 'оценка' | 'синтетика' | 'нет данных'

export interface InfoItem { status: DataStatus; text: string; url?: string }

/** Объект района. capacity и load — в единицах своего вида: места (сад, школа), м² (магазин), пасс./ч (остановка),
 *  машино-места (парковка), авт./ч (перекрёсток). capacityRange — оценка мощности «от–до», когда факта нет. */
export interface DistrictObject {
  id: string
  kind: ObjKind
  name: string
  coords: LngLat
  capacity?: number
  capacityRange?: [number, number]
  load?: number
  openYear?: number // строящийся объект работает с этого года
  info?: { capacity?: InfoItem; load?: InfoItem; registry?: InfoItem }
}

export interface District {
  name: string
  objects: DistrictObject[]
  synthetic: boolean
  dataDate: string
  sources?: { title: string; url: string; note?: string; date?: string }[]
  buildings?: [string, number, number, LngLat[], number?][] // [вид, высота м, квартир, контур, год постройки (0 — не указан)]
  roads?: [string, string, number, LngLat[]][] // [класс, название, полос, линия]
  ground?: [string, LngLat[]][] // [вид, контур] — подложка синтетической территории: кварталы, парки
  stats?: { buildings: number; flats: number; objects: number }
}

export interface Phase { name: string; year: number; apartments: number; area: number; floors?: number } // area — общая площадь квартир, м²; floors — этажность корпусов очереди (для 3D)
export interface Building { footprint: LngLat[]; floors: number; phase: number }
export interface Exit { coords: LngLat; share: number; lanes: number }

export interface Project {
  name: string
  site: LngLat[]
  buildings: Building[]
  phases: Phase[]
  residentsOverride?: number
  exits: Exit[] // пусто — exitCount выездов к ближайшим перекрёсткам
  exitCount?: number // по умолчанию 2
  rooms?: { studio: number; one: number; two: number; three: number } // доли квартир по числу комнат
  kindergartenSeats: number
  kindergartenYear?: number // по умолчанию — год ввода первой очереди
  schoolSeats: number
  schoolYear?: number
  retailArea: number
  retailYear?: number // по умолчанию — год ввода первой очереди
  parkingPlanned: number // вводятся пропорционально очередям
  stoves: 'gas' | 'electric'
  networkReserve?: { water?: number; power?: number; heat?: number } // известный резерв сетей (м³/сут, кВт)
}

export interface Scenario {
  baseYear: number
  years: number // горизонт в годах (ТЗ: 1, 3, 5 и 10 лет)
  pace: number[]
  coefs: Coefs
  wave: boolean // волна заселения (DfE/FKS)
  cohorts: boolean // динамика существующих садов и школ по когортам рождений
  constrained: boolean // стеснённая застройка: радиус 800 м
  samples: number // Монте-Карло; 0 — выключено
  seed: number
}

/** Мероприятие — меняет ЖК или район с указанного года (третье состояние «ЖК + мероприятия»). */
export interface Mitigation {
  id: string
  kind: 'kindergarten' | 'school' | 'parking' | 'retail' | 'exit' | 'intersection' | 'transit'
  amount: number // места, м/м, м², полосы выезда, % пропускной способности, рейсов/ч
  year: number
  label: string
  target?: string // id перекрёстка
}

// ---------- Результат ----------

export type Basis = 'Норматив' | 'Сценарий' | 'Факт'
export type Status = 'ok' | 'warn' | 'crit' | 'unknown' | 'uncertain'
export type Confidence = 'высокая' | 'средняя' | 'низкая'
export type Direction = 'Население' | 'Детские сады' | 'Школы' | 'Дороги' | 'Общественный транспорт' | 'Парковки' | 'Торговля и услуги' | 'Здравоохранение и спорт' | 'Инженерные сети'

export interface Metric {
  key: string
  direction: Direction
  label: string
  value: number
  unit: string
  basis: Basis
  formula: string
  source: string
  p10?: number
  p90?: number
  confidence?: Confidence
  note?: string // «не покрыто подтверждённым резервом», «требует уточнения данных» и т. п.
  steps?: Step[] // «почему так»: цепочка расчёта теми же числами, что дали значение; последний шаг = значение
}

/** Шаг объяснения: «× 10,4% — дети 0–6 лет → 484 детей», источник коротко. */
export interface Step { label: string; value: number; unit: string; src?: string }

export interface ObjectLoad {
  id: string
  name: string
  kind: ObjKind
  distance: number
  before: number | null // загрузка без ЖК в этом году, доля (z для перекрёстков)
  after: number | null // с ЖК
  range?: [number, number] // диапазон загрузки после ЖК при оценочной мощности
  added: number
  status: Status
  statusBefore: Status
  data: DataStatus
  delay?: number // BPR: во сколько раз растёт время проезда узла
}

export interface ExitLoad { coords: LngLat; flow: number; capacity: number; z: number; node?: string }

export interface YearResult {
  year: number
  population: number
  populationNorm: number
  ages: { k0to6: number; k7to17: number; working: number; elderly: number }
  metrics: Metric[]
  objects: ObjectLoad[]
  exits: ExitLoad[]
  cover: { kg: number; school: number; parking: number } // места ЖК + подтверждённый резерв; машино-места ЖК
}

export interface Recommendation {
  direction: Direction
  text: string
  deadline: string
  priority: 'высокий' | 'средний' | 'низкий'
  basis: string
  cost?: number // млн ₽
  mitigation?: Mitigation
}

export interface TornadoBar { key: CoefKey; label: string; low: number; high: number }

export interface Result {
  years: YearResult[]
  recommendations: Recommendation[]
  limitations: string[]
  tornado: { metric: string; year: number; base: number; bars: TornadoBar[] }[]
}

// ---------- Вспомогательные ----------

const c = (s: Scenario, k: CoefKey) => s.coefs[k].value
const fmt = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const seats = (x: number) => `${fmt(x)} ${x % 10 === 1 && x % 100 !== 11 ? 'место' : [2, 3, 4].includes(x % 10) && ![12, 13, 14].includes(x % 100) ? 'места' : 'мест'}`
const src = (s: Scenario, ...keys: CoefKey[]) => keys.map(k => `${s.coefs[k].label}: ${fmt(s.coefs[k].value)} ${s.coefs[k].unit} (${s.coefs[k].source})`).join('; ')
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (x: number) => `${fmt(Math.round(x * 1000) / 10)}%`
/** Короткий источник для шага объяснения — до первой запятой, точки с запятой или скобки. */
const short = (s: Scenario, k: CoefKey) => s.coefs[k].source.split(/[,;(]/)[0].trim()
const phasesSorted = (p: Project) => [...p.phases].sort((a, b) => a.year - b.year)

export function paceShare(pace: readonly number[], t: number) {
  return t < 0 ? 0 : pace[Math.min(t, pace.length - 1)]
}
function wave(curve: number[], t: number) {
  return curve[Math.max(0, Math.min(t, curve.length - 1))]
}
function births(y: number) {
  const ys = Object.keys(BIRTHS).map(Number)
  return BIRTHS[Math.min(Math.max(y, Math.min(...ys)), Math.max(...ys))]
}
/** Когорта: сумма родившихся в годах, чьи дети в году y попадают в возрастную группу [a, b]. */
const cohort = (y: number, a: number, b: number) => sum(Array.from({ length: b - a + 1 }, (_, i) => births(y - a - i)))

/** Электрическая нагрузка на квартиру по числу квартир — линейная интерполяция табл. 7.1 СП 256. */
export function powerPerApt(n: number, stoves: 'gas' | 'electric') {
  const { n: xs } = POWER_TABLE
  const ys = POWER_TABLE[stoves]
  if (n <= xs[0]) return ys[0]
  if (n >= xs.at(-1)!) return ys.at(-1)!
  const i = xs.findIndex(x => x >= n)
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (n - xs[i - 1])) / (xs[i] - xs[i - 1])
}

/** Детерминированный генератор (mulberry32) — одинаковый seed даёт одинаковый результат. */
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
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

// ---------- Спрос ЖК (скалярная часть — её гоняет Монте-Карло) ----------

export interface Demand {
  apartments: number
  aptsBuilt: number // квартиры введённых очередей (для проектной нагрузки сетей)
  population: number
  populationNorm: number
  builtArea: number
  k0to6: number
  k7to17: number
  kgScen: number
  schoolScen: number
  kgNorm: number
  schoolNorm: number
  cars: number
  carTrips: number
  personTrips: number
  ptTrips: number
  walkTrips: number
  bikeTrips: number
}

/** Изменение числа квартир очереди: площадь и «жители по проекту» масштабируются пропорционально
 *  (сохраняются м² на квартиру и жители на квартиру) — иначе стресс-тест «больше квартир» ничего бы не менял. */
export function setPhaseApartments(p: Project, i: number, apartments: number): Project {
  const old = p.phases[i]
  const k = old.apartments > 0 ? apartments / old.apartments : 1
  const total = sum(p.phases.map(x => x.apartments))
  // очередь с 0 квартир (поле стёрли до пустого) берёт средние м² на квартиру по проекту — иначе площадь залипала в 0
  const perApt = sum(p.phases.map(x => x.area)) / Math.max(1, total) || 77.5
  const phases = p.phases.map((x, j) => (j === i ? { ...x, apartments, area: old.apartments > 0 ? x.area * k : apartments * perApt } : x))
  const newTotal = total - old.apartments + apartments
  // без округления на каждом нажатии: 1 → 15 → 150 → 1500 даёт то же, что вставка 1500; округляется только показ.
  // Сумма прошла через 0 — плотность потеряна, берём типовые 2,58 чел./кв.
  const r = p.residentsOverride
  return { ...p, phases, residentsOverride: !r ? r : total > 0 ? (newTotal > 0 ? (r * newTotal) / total : r) : newTotal * DEFAULT_COEFS.occupancy.value }
}

/** Жителей на квартиру: по проекту → по структуре квартир (комнатность) → коэффициент заселения. */
export function occupancyOf(p: Project, s: Scenario) {
  const totalApts = sum(p.phases.map(x => x.apartments))
  // жители по проекту тоже масштабируются ползунком заселения — стресс-тест ТЗ «выше заселение» и Монте-Карло работают и для них
  if (p.residentsOverride && totalApts) return (p.residentsOverride / totalApts) * (c(s, 'occupancy') / DEFAULT_COEFS.occupancy.value)
  const r = p.rooms
  const share = r ? r.studio + r.one + r.two + r.three : 0
  // по комнатности; ползунок коэффициента заселения работает как множитель к типовому значению 2,58
  if (r && share > 0) return ((r.studio * c(s, 'occStudio') + r.one * c(s, 'occ1') + r.two * c(s, 'occ2') + r.three * c(s, 'occ3')) / share) * (c(s, 'occupancy') / DEFAULT_COEFS.occupancy.value)
  return c(s, 'occupancy')
}

export function demand(p: Project, s: Scenario, y: number, delay = 0): Demand {
  const occ = occupancyOf(p, s)
  let apartments = 0, aptsBuilt = 0, population = 0, builtArea = 0, k0to6 = 0, k715 = 0, k1617 = 0, kgScen = 0, schoolScen = 0
  for (const ph of p.phases) {
    const t = y - (ph.year + delay)
    const a = ph.apartments * paceShare(s.pace, t)
    const pop = a * occ
    apartments += a
    population += pop
    if (t >= 0) { builtArea += ph.area; aptsBuilt += ph.apartments }
    // волна: доля детей в новом квартале меняется с годами после ввода (DfE 2023); без волны — постоянные доли
    const wPre = s.wave ? wave(WAVE.preschool, t) : 1
    const w715 = s.wave ? (4 / 9) * wave(WAVE.primary, t) + (5 / 9) * wave(WAVE.secondary, t) : 1
    const wSec = s.wave ? wave(WAVE.secondary, t) : 1
    const a06 = pop * c(s, 'share0to6') * wPre
    const a715 = pop * c(s, 'share7to15') * w715
    const a1617 = pop * c(s, 'share16to17') * wSec
    k0to6 += a06
    k715 += a715
    k1617 += a1617
    kgScen += a06 * c(s, 'kgCoverage')
    schoolScen += a715 * c(s, 'schoolCoverageLow') + a1617 * c(s, 'schoolCoverageHigh')
  }
  const cars = (population * c(s, 'motorization')) / 1000
  const carTrips = cars * c(s, 'peakCarShare')
  const personTrips = population * c(s, 'personTripsPeak')
  const nonCar = Math.max(0, personTrips - carTrips * c(s, 'carOccupancy'))
  return {
    apartments, aptsBuilt, population, builtArea, k0to6, k7to17: k715 + k1617, kgScen, schoolScen,
    populationNorm: builtArea / c(s, 'm2PerPerson'),
    kgNorm: (builtArea * c(s, 'kgPer10k')) / 1e4,
    schoolNorm: (builtArea * c(s, 'schoolPer10k')) / 1e4,
    cars, carTrips, personTrips,
    ptTrips: nonCar * c(s, 'shareTransit'),
    // сумма долей = 1: всё, что не ОТ, делится между пешком и велосипедом
    walkTrips: nonCar * (1 - c(s, 'shareTransit')) * c(s, 'shareWalk'),
    bikeTrips: nonCar * (1 - c(s, 'shareTransit')) * (1 - c(s, 'shareWalk')),
  }
}

// ---------- Пространственная часть ----------

interface Near extends DistrictObject { d: number }

interface Ctx {
  center: LngLat
  district: District
  dataYear: number
  near: (kind: ObjKind, radius: number) => Near[]
  exits: Exit[]
  nodes: Near[]
}

function context(district: District, project: Project, s: Scenario): Ctx {
  const center = centroid(project.site)
  const withD = district.objects.map(o => ({ ...o, d: distance(center, o.coords) }))
  const near = (kind: ObjKind, radius: number) => withD.filter(o => o.kind === kind && o.d <= radius).sort((a, b) => a.d - b.d)
  const nodes = near('intersection', c(s, 'roadRadius'))
  let exits = project.exits.filter(e => e.share > 0)
  if (!exits.length) {
    // выезды по умолчанию: вершина участка, ближайшая к каждому из двух ближайших узлов
    const ring = project.site.slice(0, -1)
    exits = nodes.slice(0, Math.max(1, project.exitCount ?? 2)).map(n => ({ coords: ring.reduce((b, p) => (distance(p, n.coords) < distance(b, n.coords) ? p : b)), share: 1, lanes: 1 }))
    if (!exits.length) exits = [{ coords: center, share: 1, lanes: 1 }]
  }
  const total = sum(exits.map(e => e.share))
  exits = exits.map(e => ({ ...e, share: e.share / total }))
  return { center, district, dataYear: Number(district.dataDate.slice(0, 4)) || s.baseYear, near, exits, nodes }
}

function statusOf(r: number | null, warn: number, crit: number): Status {
  if (r === null) return 'unknown'
  return r >= crit ? 'crit' : r >= warn ? 'warn' : 'ok'
}

const dataOf = (o: DistrictObject): DataStatus =>
  o.capacity === undefined || o.load === undefined ? 'нет данных' : o.info?.capacity?.status === 'оценка' || o.capacityRange ? 'оценка' : o.info?.capacity?.status ?? 'синтетика'

/** Места в саду или школе: базовая загрузка по когортам, распределение нового спроса, резерв и дефицит. */
function education(ctx: Ctx, s: Scenario, kind: 'kindergarten' | 'school', y: number, need: number, radius: number) {
  const objs = ctx.near(kind, radius).filter(o => (o.openYear ?? 0) <= y)
  const [a, b] = kind === 'kindergarten' ? [1, 6] : [7, 17]
  const f = s.cohorts ? cohort(y, a, b) / cohort(ctx.dataYear, a, b) : 1
  const baseLoad = (o: Near) => (o.load === undefined ? undefined : o.openYear && o.openYear > ctx.dataYear ? o.load : o.load * f)
  // подтверждённый резерв: только факт или синтетика; оценка по площади и «нет данных» резервом не считаются
  const reserve = (o: Near) => {
    const bl = baseLoad(o)
    if (o.capacity === undefined || bl === undefined || o.capacityRange) return 0
    return Math.max(0, o.capacity - bl)
  }
  const reserves = objs.map(reserve)
  const totalReserve = sum(reserves)
  // куда пойдут дети: сначала в подтверждённый резерв (согласовано с дефицитом), остаток — пропорционально
  // мощности / расстоянию (модель Хаффа) — это ожидаемая локальная перегрузка; без данных — в ближайший объект
  const placed = Math.min(need, totalReserve)
  const rest = need - placed
  const known = objs.filter(o => o.capacity !== undefined)
  const w = objs.map(o => (o.capacity !== undefined ? o.capacity / Math.max(o.d, 100) : 0))
  const wSum = sum(w)
  const loads: ObjectLoad[] = objs.map((o, i) => {
    const added = (totalReserve ? (placed * reserves[i]) / totalReserve : 0) + (wSum ? (rest * w[i]) / wSum : !known.length && i === 0 ? rest : 0)
    const bl = baseLoad(o)
    const ratio = (x: number | undefined, cap: number | undefined) => (x === undefined || !cap ? null : x / cap)
    const before = ratio(bl, o.capacity)
    const after = ratio(bl === undefined ? undefined : bl + added, o.capacity)
    const range: [number, number] | undefined = o.capacityRange && bl !== undefined ? [(bl + added) / o.capacityRange[1], (bl + added) / o.capacityRange[0]] : undefined
    const warn = c(s, 'objWarn'), crit = c(s, 'critLoad')
    const st = (r: number | null, rg?: [number, number]): Status => {
      if (!rg) return statusOf(r, warn, crit)
      // оценочная мощность: вывод делаем, только если он верен на всём диапазоне
      if (rg[0] >= crit) return 'crit'
      if (rg[1] < warn) return 'ok'
      return 'uncertain'
    }
    const rangeBefore: [number, number] | undefined = o.capacityRange && bl !== undefined ? [bl / o.capacityRange[1], bl / o.capacityRange[0]] : undefined
    return { id: o.id, name: o.name, kind, distance: Math.round(o.d), before, after, range, added, status: st(after, range), statusBefore: st(before, rangeBefore), data: dataOf(o) }
  })
  return {
    loads,
    reserve: totalReserve,
    unknown: objs.filter(o => o.capacity === undefined || o.load === undefined || o.capacityRange).length,
    count: objs.length,
    cohortFactor: f,
  }
}

// ---------- Оценка одного года ----------

function applyMitigations(mits: Mitigation[], y: number) {
  const on = mits.filter(m => m.year <= y)
  const add = (k: Mitigation['kind']) => sum(on.filter(m => m.kind === k).map(m => m.amount))
  return {
    kgExtra: add('kindergarten'),
    schoolExtra: add('school'),
    parkingExtra: add('parking'),
    retailExtra: add('retail'),
    exitLanes: (i: number) => sum(on.filter(m => m.kind === 'exit' && (m.target === undefined || m.target === String(i))).map(m => m.amount)),
    transitExtra: add('transit'),
    nodeBoost: (id: string) => 1 + sum(on.filter(m => m.kind === 'intersection' && (!m.target || m.target === id)).map(m => m.amount)) / 100,
  }
}

export function evaluate(district: District, project: Project, s: Scenario, y: number, mits: Mitigation[] = [], ctx = context(district, project, s)): YearResult {
  const D = demand(project, s, y)
  const M = applyMitigations(mits, y)
  const metrics: Metric[] = []
  const objects: ObjectLoad[] = []
  const m = (x: Metric) => metrics.push({ ...x, value: Math.round(x.value) })
  const first = phasesSorted(project)[0]?.year ?? s.baseYear
  const radius = s.constrained ? 800 : c(s, 'eduRadius')
  const cover = { kg: 0, school: 0, parking: 0 }

  // Население
  m({ key: 'population', direction: 'Население', label: 'Жители ЖК (сценарий заселения)', value: D.population, unit: 'чел.', basis: 'Сценарий',
    formula: 'Σ квартир очереди × темп заселения(год − год ввода) × коэффициент заселения',
    source: (project.residentsOverride ? `жители по проекту: ${project.residentsOverride}` : project.rooms ? `по структуре квартир: ${fmt(occupancyOf(project, s))} чел./кв. (${src(s, 'occStudio', 'occ1', 'occ2', 'occ3')})` : src(s, 'occupancy')) + `; темп: ${s.pace.join(' → ')}` })
  m({ key: 'populationNorm', direction: 'Население', label: 'Расчётное население по нормативу', value: D.populationNorm, unit: 'чел.', basis: 'Норматив',
    formula: 'общая площадь квартир введённых очередей / норма м² на человека', source: src(s, 'm2PerPerson') })

  // Детские сады и школы: норматив (правовой минимум) и прогноз (демография) — раздельно
  for (const [dir, kind, normKey, scen, norm, seats, sYear, extra, key] of [
    ['Детские сады', 'kindergarten', 'kgPer10k', D.kgScen, D.kgNorm, project.kindergartenSeats, project.kindergartenYear ?? first, M.kgExtra, 'kg'],
    ['Школы', 'school', 'schoolPer10k', D.schoolScen, D.schoolNorm, project.schoolSeats, project.schoolYear ?? first, M.schoolExtra, 'school'],
  ] as const) {
    const own = (y >= sYear ? seats : 0) + extra // места в ЖК считаются только с года открытия
    const edu = education(ctx, s, kind, y, Math.max(0, scen - own), radius)
    objects.push(...edu.loads)
    const shareSrc = kind === 'kindergarten' ? src(s, 'share0to6', 'kgCoverage') : src(s, 'share7to15', 'share16to17', 'schoolCoverageLow', 'schoolCoverageHigh')
    m({ key: `${key}_norm`, direction: dir, label: 'Нормативная потребность в местах', value: norm, unit: 'мест', basis: 'Норматив',
      formula: 'общая площадь квартир × норматив / 10 000 м²', source: src(s, normKey) })
    m({ key: `${key}_scen`, direction: dir, label: 'Потребность по сценарию (демография × охват)', value: scen, unit: 'мест', basis: 'Сценарий',
      formula: kind === 'kindergarten' ? 'жители × доля 0–6 лет × волна × охват 85%' : 'жители × (доля 7–15 × 100% + доля 16–17 × 75%) × волна',
      source: shareSrc + (s.wave ? '; волна: DfE 2023 / FKS (методика, не откалибровано на Казани)' : '') })
    const note = edu.count === 0 ? `в радиусе ${radius} м нет объектов` : edu.unknown ? `объектов без подтверждённой мощности: ${edu.unknown} из ${edu.count} — итоговый дефицит требует уточнения данных` : undefined
    const def = (need: number) => Math.max(0, need - own - edu.reserve)
    cover[key] = own + edu.reserve
    const noun = kind === 'kindergarten' ? 'садов' : 'школ'
    const tail = (need: number): Step[] => [
      ...(own > 0 ? [{ label: extra > 0 ? (own > extra ? '− места в ЖК и в новых объектах' : '− места в новых объектах') : '− места в ЖК', value: own, unit: 'мест', src: extra > 0 ? 'мероприятия' : 'проект ЖК' }] : []),
      { label: edu.count ? `− свободные места в ${edu.count} ${noun} в ${radius} м` : `− свободные места: в ${radius} м ${noun} нет`, value: edu.reserve, unit: 'мест',
        src: edu.unknown ? `без подтверждённой мощности: ${edu.unknown} — не засчитаны` : 'факт' },
      { label: '= не хватает', value: def(need), unit: 'мест' },
    ]
    const normSteps: Step[] = [
      { label: 'Площадь квартир введённых очередей', value: D.builtArea, unit: 'м²', src: 'проект ЖК' },
      { label: `× ${fmt(c(s, normKey))} мест на 10 000 м²`, value: norm, unit: 'мест', src: short(s, normKey) }, ...tail(norm)]
    const scenSteps: Step[] = [
      { label: 'Жители ЖК', value: D.population, unit: 'чел.', src: 'квартиры × заселение × темп' },
      ...(kind === 'kindergarten'
        ? [{ label: `× ${pct(c(s, 'share0to6'))} — дети 0–6 лет${s.wave ? ', с волной заселения' : ''}`, value: D.k0to6, unit: 'детей', src: short(s, 'share0to6') },
          { label: `× ${pct(c(s, 'kgCoverage'))} ходят в сад`, value: scen, unit: 'мест', src: short(s, 'kgCoverage') }]
        : [{ label: `× ${pct(c(s, 'share7to15') + c(s, 'share16to17'))} — дети 7–17 лет${s.wave ? ', с волной заселения' : ''}`, value: D.k7to17, unit: 'детей', src: short(s, 'share7to15') },
          { label: `× охват: ${pct(c(s, 'schoolCoverageLow'))} в 1–9 кл., ${pct(c(s, 'schoolCoverageHigh'))} в 10–11 кл.`, value: scen, unit: 'мест', src: short(s, 'schoolCoverageLow') }]),
      ...tail(scen)]
    m({ key: `${key}_def_norm`, direction: dir, label: `Не покрыто подтверждённым резервом (норматив), ${radius} м`, value: def(norm), unit: 'мест', basis: 'Норматив', note, steps: normSteps,
      formula: 'нормативная потребность − места в ЖК (с года открытия) − подтверждённый резерв объектов в радиусе', source: `${src(s, normKey, 'eduRadius')}; мест в ЖК: ${own}; резерв: ${Math.round(edu.reserve)}` })
    m({ key: `${key}_def_scen`, direction: dir, label: `Не покрыто подтверждённым резервом (сценарий), ${radius} м`, value: def(scen), unit: 'мест', basis: 'Сценарий', note, steps: scenSteps,
      formula: 'прогнозная потребность − места в ЖК − подтверждённый резерв объектов в радиусе',
      source: `${shareSrc}; мест в ЖК: ${own}; резерв: ${Math.round(edu.reserve)}${s.cohorts ? `; база по когортам рождений ×${edu.cohortFactor.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} к ${ctx.dataYear} г. (${BIRTHS_SOURCE})` : ''}` })
  }

  // Дороги: поездки в утренний час пик → выезды → узлы (первый узел 100%, далее 60% на два следующих)
  m({ key: 'car_trips', direction: 'Дороги', label: 'Доп. поездки на авто, утренний час пик', value: D.carTrips, unit: 'авт./ч', basis: 'Сценарий',
    steps: [{ label: 'Жители ЖК', value: D.population, unit: 'чел.', src: 'квартиры × заселение × темп' },
      { label: `× ${fmt(c(s, 'motorization'))} машин на 1 000 жителей`, value: D.cars, unit: 'машин', src: short(s, 'motorization') },
      { label: `× ${pct(c(s, 'peakCarShare'))} выезжают в утренний час пик`, value: D.carTrips, unit: 'авт./ч', src: short(s, 'peakCarShare') }],
    formula: 'жители × автомобилизация / 1000 × доля авто, выезжающих в пик', source: src(s, 'motorization', 'peakCarShare') })
  const added = new Map<string, number>()
  const exits: ExitLoad[] = ctx.exits.map((e, i) => {
    const flow = D.carTrips * e.share
    const capacity = c(s, 'exitCapacity') * (e.lanes + M.exitLanes(i))
    const byNear = [...ctx.nodes].sort((a, b) => distance(e.coords, a.coords) - distance(e.coords, b.coords))
    const n1 = byNear[0]
    if (n1) {
      added.set(n1.id, (added.get(n1.id) ?? 0) + flow)
      const next = ctx.nodes.filter(n => n.id !== n1.id).map(n => ({ n, d: distance(n1.coords, n.coords) })).filter(x => x.d < 1000).sort((a, b) => a.d - b.d).slice(0, 2)
      const wSum = sum(next.map(x => 1 / Math.max(x.d, 50)))
      for (const x of next) added.set(x.n.id, (added.get(x.n.id) ?? 0) + (0.6 * flow * (1 / Math.max(x.d, 50))) / wSum)
    }
    return { coords: e.coords, flow, capacity, z: capacity ? flow / capacity : 0, node: n1?.name }
  })
  for (const o of ctx.nodes) {
    const add = added.get(o.id) ?? 0
    const cap = o.capacity ? o.capacity * M.nodeBoost(o.id) : undefined
    const before = o.capacity && o.load !== undefined ? o.load / o.capacity : null
    const after = cap && o.load !== undefined ? (o.load + add) / cap : null
    objects.push({ id: o.id, name: o.name, kind: 'intersection', distance: Math.round(o.d), before, after, added: add,
      status: statusOf(after, c(s, 'warnLoad'), c(s, 'critLoad')), statusBefore: statusOf(before, c(s, 'warnLoad'), c(s, 'critLoad')),
      data: o.info?.load?.status ?? (o.load === undefined ? 'нет данных' : 'синтетика'), delay: after === null ? undefined : 1 + 0.15 * after ** 4 })
  }
  const critNodes = objects.filter(o => o.kind === 'intersection' && o.status === 'crit' && o.statusBefore !== 'crit' && o.added > 0)
  const worstNode = objects.filter(o => o.kind === 'intersection' && o.added > 0 && o.after !== null).sort((a, b) => b.after! - a.after!)[0]
  const nodeSteps: Step[] = worstNode ? [
    { label: 'Машин из ЖК в утренний час', value: D.carTrips, unit: 'авт./ч', src: 'поездки жителей' },
    { label: `→ на самый загруженный узел «${worstNode.name}»`, value: worstNode.added, unit: 'авт./ч', src: 'выезд → ближайший узел' },
    { label: 'загрузка узла без ЖК', value: (worstNode.before ?? 0) * 100, unit: '%', src: worstNode.data },
    { label: 'загрузка с ЖК', value: worstNode.after! * 100, unit: '%', src: 'пропускная способность ОДМ 218.6.003' },
    { label: '= перекрёстков стало перегружено', value: critNodes.length, unit: 'шт.' }] : []
  m({ key: 'crit_nodes', direction: 'Дороги', label: `Перекрёстков, перешедших в критическую зону (z ≥ ${fmt(c(s, 'critLoad'))})`, value: critNodes.length, unit: 'шт.', basis: 'Сценарий',
    formula: 'z = (базовая интенсивность + прирост от ЖК) / пропускная способность; задержка по BPR: 1 + 0,15 z⁴', source: src(s, 'warnLoad', 'critLoad'), steps: nodeSteps,
    note: ctx.nodes.some(n => n.info?.load?.status === 'синтетика') ? 'базовая интенсивность — допущение по классу улицы (нет данных детекторов)' : undefined })
  m({ key: 'exit_z', direction: 'Дороги', label: 'Максимальная загрузка выезда из ЖК', value: Math.max(0, ...exits.map(e => e.z)) * 100, unit: '%', basis: 'Сценарий',
    formula: 'поток выезда / (пропускная способность выезда × полос)', source: src(s, 'exitCapacity') })

  // Общественный транспорт
  m({ key: 'pt_trips', direction: 'Общественный транспорт', label: 'Доп. поездки на ОТ, утренний час пик', value: D.ptTrips, unit: 'пасс./ч', basis: 'Сценарий',
    formula: '(поездки жителей − поездки на авто × наполняемость) × доля ОТ', source: src(s, 'personTripsPeak', 'carOccupancy', 'shareTransit') })
  const stops = ctx.near('stop', c(s, 'stopRadius')).filter(o => (o.openYear ?? 0) <= y)
  const wStops = stops.map(o => 1 / Math.max(o.d, 50))
  let overCap = 0
  stops.forEach((o, i) => {
    const add = (D.ptTrips * wStops[i]) / sum(wStops)
    const cap = o.capacity ? o.capacity + M.transitExtra * c(s, 'busCapacity') / Math.max(1, stops.length) : undefined
    const before = o.capacity && o.load !== undefined ? o.load / o.capacity : null
    const after = cap && o.load !== undefined ? (o.load + add) / cap : null
    if (cap && o.load !== undefined) overCap += Math.max(0, o.load + add - cap)
    objects.push({ id: o.id, name: o.name, kind: 'stop', distance: Math.round(o.d), before, after, added: add, status: statusOf(after, c(s, 'objWarn'), c(s, 'critLoad')),
      statusBefore: statusOf(before, c(s, 'objWarn'), c(s, 'critLoad')), data: dataOf(o) })
  })
  const stopsKnown = stops.length > 0 && stops.every(o => o.capacity !== undefined && o.load !== undefined)
  const buses = stopsKnown ? overCap / c(s, 'busCapacity') : Math.max(0, D.ptTrips / c(s, 'busCapacity') - M.transitExtra)
  const ptSteps: Step[] = [
    { label: 'Жители ЖК', value: D.population, unit: 'чел.', src: 'квартиры × заселение × темп' },
    { label: `× ${fmt(c(s, 'personTripsPeak'))} поездки в утренний час`, value: D.personTrips, unit: 'поездок', src: short(s, 'personTripsPeak') },
    { label: `− едут на машине (× ${fmt(c(s, 'carOccupancy'))} чел. в машине)`, value: D.carTrips * c(s, 'carOccupancy'), unit: 'поездок', src: short(s, 'carOccupancy') },
    { label: `× ${pct(c(s, 'shareTransit'))} — на общественном транспорте`, value: D.ptTrips, unit: 'пасс./ч', src: short(s, 'shareTransit') },
    ...(stopsKnown ? [{ label: '− свободная вместимость остановок рядом', value: Math.max(0, D.ptTrips - overCap), unit: 'пасс./ч', src: 'данные остановок' }] : []),
    { label: `÷ ${fmt(c(s, 'busCapacity'))} пассажиров в автобусе`, value: Math.ceil(buses), unit: 'рейсов/ч', src: short(s, 'busCapacity') }]
  m({ key: 'pt_buses', direction: 'Общественный транспорт', label: stopsKnown ? 'Нужно доп. рейсов в пиковый час' : 'Доп. рейсов в час, если у маршрутов нет резерва', value: Math.ceil(buses), unit: 'рейс/ч', basis: 'Сценарий', steps: ptSteps,
    formula: stopsKnown ? 'превышение провозной способности остановок / вместимость автобуса' : 'поездки на ОТ / вместимость автобуса (верхняя оценка)', source: src(s, 'busCapacity'),
    note: stopsKnown ? undefined : 'провозная способность маршрутов не известна — нужна сверка с перевозчиком' })
  m({ key: 'stops_near', direction: 'Общественный транспорт', label: `Остановок в ${fmt(c(s, 'stopRadius'))} м`, value: stops.length, unit: 'шт.', basis: 'Факт',
    formula: 'остановки в нормативном радиусе пешеходной доступности', source: src(s, 'stopRadius') })

  // Парковки: норматив от площади, прогноз — автомобили жителей
  const metro = ctx.near('metro', 500).filter(o => (o.openYear ?? 0) <= y)
  const cut = metro.length ? 1 - c(s, 'metroParkCut') : 1
  const parkNorm = Math.ceil((D.builtArea / c(s, 'parkM2')) * cut) + Math.ceil(D.builtArea / c(s, 'guestParkM2'))
  const totalApts = sum(project.phases.map(p => p.apartments))
  const planned = (totalApts ? (project.parkingPlanned * sum(project.phases.filter(p => p.year <= y).map(p => p.apartments))) / totalApts : 0) + M.parkingExtra
  cover.parking = planned
  m({ key: 'parking_norm', direction: 'Парковки', label: 'Нормативная потребность в машино-местах', value: parkNorm, unit: 'м/м', basis: 'Норматив',
    formula: `площадь квартир / 80${metro.length ? ' × 0,8 (метро в 500 м)' : ''} + площадь / 560 (гостевые), с округлением вверх`, source: src(s, 'parkM2', 'guestParkM2', 'metroParkCut') })
  const permanent = Math.ceil((D.builtArea / c(s, 'parkM2')) * cut), guest = Math.ceil(D.builtArea / c(s, 'guestParkM2'))
  m({ key: 'parking_def', direction: 'Парковки', label: 'Дефицит машино-мест к нормативу', value: Math.max(0, parkNorm - planned), unit: 'м/м', basis: 'Норматив',
    steps: [{ label: 'Площадь квартир введённых очередей', value: D.builtArea, unit: 'м²', src: 'проект ЖК' },
      { label: `÷ ${fmt(c(s, 'parkM2'))} м² на машино-место${metro.length ? `, × ${fmt(cut)} — метро в 500 м` : ''}`, value: permanent, unit: 'м/м', src: short(s, 'parkM2') },
      { label: `+ гостевые: ÷ ${fmt(c(s, 'guestParkM2'))} м²`, value: guest, unit: 'м/м', src: short(s, 'guestParkM2') },
      { label: '= нужно по нормативу', value: parkNorm, unit: 'м/м' },
      { label: '− машино-места в ЖК', value: planned, unit: 'м/м', src: 'проект ЖК' },
      { label: '= не хватает', value: Math.max(0, parkNorm - planned), unit: 'м/м' }],
    formula: 'нормативная потребность − машино-места в ЖК (вводятся с очередями)', source: `в ЖК: ${Math.round(planned)}` })
  m({ key: 'parking_cars', direction: 'Парковки', label: 'Автомобилей у жителей', value: D.cars, unit: 'авт.', basis: 'Сценарий', formula: 'жители × автомобилизация / 1000', source: src(s, 'motorization') })
  m({ key: 'parking_spill', direction: 'Парковки', label: 'Риск переноса парковки на соседние территории', value: Math.max(0, D.cars - planned), unit: 'авт.', basis: 'Сценарий',
    formula: 'автомобили жителей − машино-места в ЖК', source: src(s, 'motorization') + `; в ЖК: ${Math.round(planned)}` })

  // Торговля и услуги
  const retailNorm = (D.builtArea * c(s, 'retailPer10k')) / 1e4
  const shops = ctx.near('shop', c(s, 'retailRadius')).filter(o => (o.openYear ?? 0) <= y)
  const pharm = ctx.near('pharmacy', c(s, 'retailRadius')).filter(o => (o.openYear ?? 0) <= y)
  const shopReserve = sum(shops.map(o => (o.capacity !== undefined && o.load !== undefined ? Math.max(0, o.capacity - o.load) : 0)))
  const ownRetail = (y >= (project.retailYear ?? first) ? project.retailArea : 0) + M.retailExtra
  m({ key: 'retail_norm', direction: 'Торговля и услуги', label: 'Нормативная торговая площадь повседневного спроса', value: retailNorm, unit: 'м²', basis: 'Норматив',
    formula: 'площадь квартир × 33,1 / 10 000 м²', source: src(s, 'retailPer10k') })
  const shopsUnknown = shops.some(o => o.capacity === undefined)
  m({ key: 'retail_def', direction: 'Торговля и услуги', label: `Не покрыто подтверждённой площадью в ${c(s, 'retailRadius')} м`, value: Math.max(0, retailNorm - ownRetail - shopReserve), unit: 'м²', basis: 'Норматив',
    steps: [{ label: 'Площадь квартир введённых очередей', value: D.builtArea, unit: 'м²', src: 'проект ЖК' },
      { label: `× ${fmt(c(s, 'retailPer10k'))} м² торговли на 10 000 м²`, value: retailNorm, unit: 'м²', src: short(s, 'retailPer10k') },
      ...(ownRetail > 0 ? [{ label: '− торговля в ЖК', value: ownRetail, unit: 'м²', src: 'проект ЖК' }] : []),
      { label: shops.length ? `− свободная площадь ${shops.length} магазинов в ${fmt(c(s, 'retailRadius'))} м` : `− магазинов в ${fmt(c(s, 'retailRadius'))} м нет`, value: shopReserve, unit: 'м²',
        src: shopsUnknown ? 'площадь магазинов не известна — не засчитана' : 'данные района' },
      { label: '= не покрыто', value: Math.max(0, retailNorm - ownRetail - shopReserve), unit: 'м²' }],
    formula: 'нормативная площадь − торговля в ЖК − свободная площадь магазинов в радиусе', source: `${src(s, 'retailRadius')}; в ЖК: ${ownRetail} м²; магазинов в радиусе: ${shops.length}`,
    note: shops.some(o => o.capacity === undefined) ? `в радиусе ${shops.length} магазинов повседневного спроса, их площадь не известна` : undefined })
  m({ key: 'pharmacies', direction: 'Торговля и услуги', label: `Аптек в ${c(s, 'retailRadius')} м`, value: pharm.length, unit: 'шт.', basis: 'Факт', formula: 'аптеки в нормативном радиусе', source: src(s, 'retailRadius') })
  m({ key: 'catering', direction: 'Торговля и услуги', label: 'Общепит микрорайонного уровня', value: (D.builtArea * c(s, 'cateringPer10k')) / 1e4, unit: 'пос. мест', basis: 'Норматив',
    formula: 'площадь квартир × норматив / 10 000 м²', source: src(s, 'cateringPer10k') })
  m({ key: 'services', direction: 'Торговля и услуги', label: 'Бытовые услуги', value: Math.ceil((D.builtArea * c(s, 'servicesPer10k')) / 1e4), unit: 'раб. мест', basis: 'Норматив',
    formula: 'площадь квартир × норматив / 10 000 м²', source: src(s, 'servicesPer10k') })

  // Здравоохранение и спорт — потенциальная нагрузка (мощности не известны)
  const clinics = ctx.near('clinic', c(s, 'clinicRadius'))
  m({ key: 'clinic_visits', direction: 'Здравоохранение и спорт', label: 'Потенциальная нагрузка на поликлиники', value: (D.population * c(s, 'clinicPer1000')) / 1000, unit: 'посещ. в смену', basis: 'Сценарий',
    formula: 'жители × норматив / 1000', source: src(s, 'clinicPer1000'), note: `объектов здравоохранения в ${c(s, 'clinicRadius')} м: ${clinics.length}; мощность не известна — вывод о достаточности не делается` })
  m({ key: 'sport_halls', direction: 'Здравоохранение и спорт', label: 'Спортивные залы', value: (D.builtArea * c(s, 'sportHallPer10k')) / 1e4, unit: 'м² пола', basis: 'Норматив',
    formula: 'площадь квартир × норматив / 10 000 м²', source: src(s, 'sportHallPer10k') })

  // Инженерные сети — проектная нагрузка введённых очередей (сеть должна быть готова к вводу), резерв сетей не известен
  const popDesign = Math.max(D.populationNorm, D.population)
  const water = (popDesign * c(s, 'water')) / 1000
  m({ key: 'water', direction: 'Инженерные сети', label: 'Водопотребление', value: water, unit: 'м³/сут', basis: 'Норматив',
    steps: [{ label: 'Расчётные жители введённых очередей', value: popDesign, unit: 'чел.', src: 'больше из норматива и сценария' },
      { label: `× ${fmt(c(s, 'water'))} л в сутки на человека`, value: water, unit: 'м³/сут', src: short(s, 'water') }], formula: 'расчётное население введённых очередей (max из нормативного и сценарного) × норма / 1000', source: src(s, 'water', 'm2PerPerson') })
  m({ key: 'sewer', direction: 'Инженерные сети', label: 'Водоотведение', value: water, unit: 'м³/сут', basis: 'Норматив', formula: 'равно водопотреблению (МНГП п. 5.3.4.2.6)', source: src(s, 'water') })
  m({ key: 'power', direction: 'Инженерные сети', label: 'Электрическая нагрузка квартир', value: D.aptsBuilt ? D.aptsBuilt * powerPerApt(D.aptsBuilt, project.stoves) : 0, unit: 'кВт', basis: 'Норматив',
    formula: `квартиры введённых очередей × удельная нагрузка по их числу (${project.stoves === 'gas' ? 'газовые' : 'электрические'} плиты)`, source: 'СП 256.1325800.2016, табл. 7.1 (интерполяция)' })
  m({ key: 'heat', direction: 'Инженерные сети', label: 'Тепловая нагрузка (отопление)', value: (D.builtArea * c(s, 'heat')) / 1e6 * 1000, unit: 'кВт', basis: 'Норматив',
    formula: 'площадь квартир × удельная характеристика', source: src(s, 'heat') })

  return {
    year: y,
    population: Math.round(D.population),
    populationNorm: Math.round(D.populationNorm),
    ages: { k0to6: Math.round(D.k0to6), k7to17: Math.round(D.k7to17), elderly: Math.round(D.population * c(s, 'shareElderly')),
      working: Math.round(D.population - D.k0to6 - D.k7to17 - D.population * c(s, 'shareElderly')) },
    metrics,
    objects,
    exits,
    cover,
  }
}

// ---------- Неопределённость ----------

const UNCERTAIN = (Object.keys(DEFAULT_COEFS) as CoefKey[]).filter(k => (DEFAULT_COEFS[k] as { range?: [number, number] }).range)
const MC_KEYS: (keyof Demand)[] = ['population', 'kgScen', 'schoolScen', 'carTrips', 'ptTrips', 'cars']
const MC_METRIC: Record<string, keyof Demand> = { population: 'population', kg_scen: 'kgScen', school_scen: 'schoolScen', car_trips: 'carTrips', pt_trips: 'ptTrips', parking_cars: 'cars' }

/** Монте-Карло по допущениям: равномерно в диапазонах из coefficients.ts + сдвиг ввода на год с вероятностью 30%
 *  (главный источник ошибки прогнозов застройки — сроки, Хельсинки/Стокгольм). Нормативы не варьируются.
 *  Результат — «диапазон по допущениям» P10–P90, а не доверительный интервал статистической модели. */
/** Заселение по комнатности уже варьируется через occStudio…occ3 — общий коэффициент заселения второй раз не разыгрываем. */
const byRooms = (p: Project) => !p.residentsOverride && !!p.rooms && p.rooms.studio + p.rooms.one + p.rooms.two + p.rooms.three > 0
const uncertainKeys = (p: Project) => UNCERTAIN.filter(k => !(k === 'occupancy' && byRooms(p)))

function monteCarlo(project: Project, s: Scenario, years: number[]) {
  const rand = rng(s.seed)
  const out = new Map<number, Record<string, number[]>>(years.map(y => [y, Object.fromEntries(MC_KEYS.map(k => [k, []]))]))
  const keys = uncertainKeys(project)
  for (let i = 0; i < s.samples; i++) {
    const coefs = { ...s.coefs }
    for (const k of keys) {
      // относительный разброс источника переносится на выбранное пользователем значение
      const [lo, hi] = scaledRange(s, k)
      coefs[k] = { ...coefs[k], value: lo + (hi - lo) * rand() }
    }
    const delay = rand() < 0.3 ? 1 : 0
    const si = { ...s, coefs }
    for (const y of years) {
      const d = demand(project, si, y, delay)
      const bucket = out.get(y)!
      for (const k of MC_KEYS) bucket[k].push(d[k])
    }
  }
  return out
}

/** Диапазон допущения вокруг текущего значения: [lo, hi] источника × (значение / значение по умолчанию). */
function scaledRange(s: Scenario, k: CoefKey): [number, number] {
  const [lo, hi] = s.coefs[k].range ?? (DEFAULT_COEFS[k] as { range: [number, number] }).range
  const f = s.coefs[k].value / DEFAULT_COEFS[k].value
  return [lo * f, hi * f]
}

function confidenceOf(p10: number, p50: number, p90: number): Confidence {
  const w = p50 ? (p90 - p10) / p50 : 0
  return w < 0.2 ? 'высокая' : w < 0.5 ? 'средняя' : 'низкая'
}

/** Торнадо: как меняется показатель при сдвиге одного допущения к краям диапазона. */
function tornado(project: Project, s: Scenario, y: number, key: keyof Demand): TornadoBar[] {
  const base = demand(project, s, y)[key]
  return uncertainKeys(project).map(k => {
    const at = (v: number) => demand(project, { ...s, coefs: { ...s.coefs, [k]: { ...s.coefs[k], value: v } } }, y)[key] - base
    const [lo, hi] = scaledRange(s, k)
    return { key: k, label: s.coefs[k].label, low: at(lo), high: at(hi) }
  }).filter(b => Math.abs(b.low) + Math.abs(b.high) > 0.5).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low))
}

// ---------- Прогон и рекомендации ----------

export const defaultScenario = (): Scenario => ({
  baseYear: 2026, years: 10, pace: [...PACE.base.pace], coefs: structuredClone(DEFAULT_COEFS),
  wave: false, cohorts: true, constrained: false, samples: 400, seed: 20261001,
})

const metricOf = (h: YearResult, key: string) => h.metrics.find(x => x.key === key)!

export function run(district: District, project: Project, s: Scenario = defaultScenario(), mits: Mitigation[] = []): Result {
  const ctx = context(district, project, s)
  const yearsList = Array.from({ length: s.years + 1 }, (_, i) => s.baseYear + i)
  const years = yearsList.map(y => evaluate(district, project, s, y, mits, ctx))

  if (s.samples > 0) {
    const mc = monteCarlo(project, s, yearsList)
    years.forEach(h => {
      const bucket = mc.get(h.year)!
      for (const mt of h.metrics) {
        const k = MC_METRIC[mt.key]
        if (!k) continue
        const xs = bucket[k]
        mt.p10 = Math.round(quantile(xs, 0.1))
        mt.p90 = Math.round(quantile(xs, 0.9))
        mt.confidence = confidenceOf(mt.p10, quantile(xs, 0.5), mt.p90)
      }
      // дефициты по прогнозу: тот же резерв, спрос из выборки
      for (const [key, dk] of [['kg', 'kgScen'], ['school', 'schoolScen']] as const) {
        const def = metricOf(h, `${key}_def_scen`)
        const xs = bucket[dk].map(v => Math.max(0, v - h.cover[key])) // места ЖК + подтверждённый резерв
        def.p10 = Math.round(quantile(xs, 0.1))
        def.p90 = Math.round(quantile(xs, 0.9))
        def.confidence = def.note ? 'низкая' : confidenceOf(def.p10, quantile(xs, 0.5), def.p90)
      }
      const spill = metricOf(h, 'parking_spill'), cars = metricOf(h, 'parking_cars')
      spill.p10 = Math.max(0, (cars.p10 ?? 0) - h.cover.parking)
      spill.p90 = Math.max(0, (cars.p90 ?? 0) - h.cover.parking)
      spill.confidence = cars.confidence
    })
  }
  // уверенность каждого результата: пометка о неполных данных → низкая; производные от населения или поездок → как у них
  const derived: Record<string, string> = { water: 'population', sewer: 'population', clinic_visits: 'population', crit_nodes: 'car_trips', exit_z: 'car_trips', pt_buses: 'pt_trips', parking_spill: 'parking_cars' }
  for (const h of years) for (const mt of h.metrics) {
    if (mt.note) mt.confidence = 'низкая'
    else if (!mt.confidence && derived[mt.key]) mt.confidence = metricOf(h, derived[mt.key]).confidence ?? 'средняя'
    else if (!mt.confidence) mt.confidence = mt.basis === 'Сценарий' ? 'средняя' : 'высокая'
  }

  const recommendations = recommend(project, s, years)
  const peakYear = years.reduce((b, h) => (metricOf(h, 'school_scen').value > metricOf(b, 'school_scen').value ? h : b)).year
  return {
    years,
    recommendations,
    tornado: [
      { metric: 'Места в школах (прогноз)', year: peakYear, base: Math.round(demand(project, s, peakYear).schoolScen), bars: tornado(project, s, peakYear, 'schoolScen') },
      { metric: 'Поездки на авто в утренний пик', year: s.baseYear + s.years, base: Math.round(demand(project, s, s.baseYear + s.years).carTrips), bars: tornado(project, s, s.baseYear + s.years, 'carTrips') },
    ],
    limitations: [
      'Предварительная оценка: не заменяет документацию по планировке территории, транспортное моделирование и инженерные изыскания.',
      'Нормативная оценка (МНГП Казани, СП) и прогноз (демография, заселение) считаются раздельно; норматив не выдаётся за статистический прогноз.',
      'Диапазон P10–P90 — разброс результата при варьировании допущений в пределах, указанных в источниках, и сдвиге ввода на год; это не доверительный интервал статистической модели: исторических рядов по району нет.',
      ...(s.cohorts ? [`Изменение загрузки существующих садов и школ — по когортам рождений Казани (${BIRTHS_SOURCE}).`] : []),
      ...(s.wave ? ['Волна заселения — форма по DfE (Англия, 2023) и FolgekostenSchätzer (Бранденбург), на данных Казани не откалибрована.'] : []),
      'При отсутствии данных о мощности или загрузке вывод «мощности достаточно» не делается; оценочная мощность (по площади здания) в резерв не засчитывается — дефицит «не покрыто подтверждённым резервом» является верхней оценкой.',
      'Доступность садов, школ, остановок и торговли — радиус по прямой от центра участка; пешеходный маршрут (переходы, барьеры) не проверяется.',
      'Транспорт: упрощённое назначение (выезд → ближайший узел → два следующих), без перераспределения по сети; базовая интенсивность — данные района или допущение по классу улицы.',
      ...(district.synthetic ? ['Данные района синтетические — результат иллюстрирует метод.'] : []),
    ],
  }
}

function recommend(project: Project, s: Scenario, years: YearResult[]): Recommendation[] {
  const recs: Recommendation[] = []
  const last = years.at(-1)!
  const phases = phasesSorted(project)
  const at = (y: number) => {
    const ph = phases.filter(p => p.year <= y).at(-1)
    return ph ? `к ${y} г. (ввод: ${ph.name})` : `к ${y} г.`
  }
  const firstYear = (pred: (h: YearResult) => boolean) => years.find(pred)?.year
  const prio = (v: number, base: number): Recommendation['priority'] => (v > 0.2 * base ? 'высокий' : v > 0.05 * base ? 'средний' : 'низкий')

  // Сады и школы: объём — максимум по годам из норматива и сценария (P90 — верхняя граница, Гётеборг)
  for (const [key, dir, unitKey, costKey, noun, kind] of [
    ['kg', 'Детские сады', 'kgUnit', 'kgCost', 'детском саду', 'kindergarten'],
    ['school', 'Школы', 'schoolUnit', 'schoolCost', 'школе', 'school'],
  ] as const) {
    const need = (h: YearResult) => Math.max(metricOf(h, `${key}_def_norm`).value, metricOf(h, `${key}_def_scen`).value)
    const peak = years.reduce((b, h) => (need(h) > need(b) ? h : b))
    const amount = need(peak)
    if (amount <= 0) continue
    const y0 = firstYear(h => need(h) > 0)!
    const upper = metricOf(peak, `${key}_def_scen`).p90
    const unit = c(s, unitKey)
    const lasting = years.filter(h => metricOf(h, `${key}_def_scen`).value > 0).length
    const temporary = kind === 'school' && s.wave && metricOf(last, `${key}_def_scen`).value === 0 && lasting > 0 && lasting < 7
    // Форма: сад до 150 мест — встроенно-пристроенный (СП 252.1325800.2016, п. 7.1.2), больше — отдельное здание;
    // школа от половины типовой (612 мест) — новое здание, меньше — пристрой или расширение
    const building = kind === 'kindergarten' ? amount > 150 : amount >= 0.5 * unit
    const count = building ? Math.ceil(amount / unit) : 0 // типовых объектов нужно
    const capacity = building ? count * unit : amount
    const how = temporary ? 'временные (модульные) места — пик короче 7 лет (практика Хертфордшира)'
      : kind === 'kindergarten' ? (building ? `${count > 1 ? `${count} отдельно стоящих детских сада` : 'отдельно стоящий детский сад'} по ${unit} мест: встроенные ДОО — не более 150 мест (СП 252.1325800.2016, п. 7.1.2)` : 'встроенно-пристроенный детский сад в первых этажах ЖК (до 150 мест, СП 252.1325800.2016, п. 7.1.2)')
        : building ? `${count > 1 ? `${count} новых здания школ` : 'новое здание школы'} на ${seats(unit)}: потребность больше половины типового` : 'пристрой или расширение ближайших школ'
    const note = metricOf(peak, `${key}_def_scen`).note
    const cost = capacity * c(s, costKey) // стоимость — по мощности мероприятия, не по дефициту
    // новый объект не построить быстрее проектирования и стройки: сад ~2 года, школа ~3 года (допущение)
    const ready = s.baseYear + (kind === 'school' ? 3 : 2)
    const late = y0 < ready && building ? `. Новый объект реально ввести не ранее ${ready} г. — до этого временные группы или подвоз в объекты вне зоны доступности` : ''
    const mYear = building ? Math.max(y0, ready) : y0
    // по очередям: срок первой очереди не должен нести пиковый объём
    const steps = phases.map(ph => { const h = years.find(x => x.year === ph.year); return h ? `к ${ph.year} г. (${ph.name}) — ${fmt(need(h))}` : '' }).filter(Boolean)
    recs.push({ direction: dir, priority: prio(amount, metricOf(peak, `${key}_norm`).value || amount), deadline: at(y0), cost,
      text: `Предусмотреть не менее ${fmt(amount)} дополнительных мест в ${noun} к ${peak.year} г. (пик)${upper && upper > amount ? `, при неблагоприятных допущениях до ${fmt(upper)}` : ''}${steps.length > 1 ? `; по очередям: ${steps.join(', ')}` : ''}; форма — ${how}${late}${note ? `. ${note[0].toUpperCase()}${note.slice(1)}` : ''}`,
      basis: `${metricOf(peak, `${key}_def_norm`).formula}; ${metricOf(peak, `${key}_def_norm`).source}; сценарий: ${metricOf(peak, `${key}_def_scen`).source}; пик в ${peak.year} г.; стоимость ${fmt(capacity)} мест × ${fmt(c(s, costKey))} млн ₽ (${s.coefs[costKey].source})`,
      mitigation: { id: `m-${key}`, kind, amount: capacity, year: mYear, label: `+${seats(capacity)} в ${noun} к ${mYear} г.` } })
  }

  // Дороги: выезды и узлы
  const exitOver = years.find(h => h.exits.some(e => e.z >= 1))
  if (exitOver) {
    const ei = exitOver.exits.reduce((b, x, i, arr) => (x.z > arr[b].z ? i : b), 0)
    const e = exitOver.exits[ei]
    recs.push({ direction: 'Дороги', priority: 'высокий', deadline: at(exitOver.year),
      text: `Изменить схему выезда: поток ${Math.round(e.flow)} авт./ч превышает пропускную способность выезда (${Math.round(e.capacity)} авт./ч) — добавить выезд или полосу, развести на две улицы`,
      basis: `${metricOf(exitOver, 'exit_z').formula}; ${src(s, 'exitCapacity')}`,
      mitigation: { id: 'm-exit', kind: 'exit', amount: 1, year: exitOver.year, target: String(ei), label: `+1 полоса на выезде ${ei + 1} к ${exitOver.year}` } })
  }
  const crit = last.objects.filter(o => o.kind === 'intersection' && o.added > 1 && (o.status === 'crit' || (o.status === 'warn' && o.statusBefore === 'ok')))
  for (const o of crit) {
    const y0 = firstYear(h => h.objects.some(x => x.id === o.id && x.status === o.status)) ?? last.year
    const boost = Math.max(10, Math.ceil(((o.after! / 0.85 - 1) * 100) / 5) * 5) // довести z до 0,85 — уровень D по шкале ОДМ 218.2.020 (0,9–1,0 — уже E, заторы); для узлов «на пределе» — оптимизация цикла ≈ +10%
    recs.push({ direction: 'Дороги', priority: o.status === 'crit' ? 'высокий' : 'средний', deadline: `до ${y0} г.`,
      text: `Перекрёсток «${o.name}»: загрузка ${Math.round((o.before ?? 0) * 100)}% → ${Math.round(o.after! * 100)}%, задержка ×${fmt(Math.round(o.delay! * 10) / 10)} — ${o.status === 'crit' ? 'увеличить пропускную способность (полоса, светофорный цикл) или изменить схему ОДД' : 'пересчитать светофорный цикл'}`,
      basis: `${metricOf(last, 'crit_nodes').formula}; ${src(s, 'motorization', 'peakCarShare')}${metricOf(last, 'crit_nodes').note ? '; ' + metricOf(last, 'crit_nodes').note : ''}`,
      mitigation: { id: `m-node-${o.id}`, kind: 'intersection', amount: boost, year: y0, target: o.id, label: `+${boost}% пропускной способности узла «${o.name}»` } })
  }

  // Общественный транспорт
  const buses = metricOf(last, 'pt_buses')
  if (buses.value > 0) recs.push({ direction: 'Общественный транспорт', priority: 'средний', deadline: at(firstYear(h => metricOf(h, 'pt_buses').value > 0) ?? last.year),
    text: `Увеличить частоту ОТ в утренний и вечерний пик: +${buses.value} рейсов в час${buses.note ? ' (верхняя оценка: резерв маршрутов не известен)' : ''}`, basis: `${buses.formula}; ${metricOf(last, 'pt_trips').source}`,
    mitigation: { id: 'm-pt', kind: 'transit', amount: buses.value, year: phases[0]?.year ?? s.baseYear, label: `+${buses.value} рейсов/ч` } })
  if (metricOf(last, 'stops_near').value === 0) recs.push({ direction: 'Общественный транспорт', priority: 'высокий', deadline: at(phases[0]?.year ?? s.baseYear),
    text: `Организовать новый остановочный пункт: в ${fmt(c(s, 'stopRadius'))} м от ЖК нет остановок`, basis: src(s, 'stopRadius') })

  // Парковки
  // по всему горизонту: дефицит может исчезнуть после открытия метро (−20% норматива), но быть в ранние годы
  const pdYear = years.reduce((b, h) => (metricOf(h, 'parking_def').value > metricOf(b, 'parking_def').value ? h : b))
  const pd = metricOf(pdYear, 'parking_def'), spill = metricOf(last, 'parking_spill')
  if (pd.value > 0) recs.push({ direction: 'Парковки', priority: prio(pd.value, metricOf(pdYear, 'parking_norm').value), deadline: at(firstYear(h => metricOf(h, 'parking_def').value > 0) ?? last.year),
    text: `Добавить ${fmt(pd.value)} машино-мест до норматива МНГП${metricOf(last, 'parking_def').value < pd.value ? ` (к ${last.year} г. потребность снижается до ${metricOf(last, 'parking_def').value} — часть мест можно сделать временными)` : ''}`, basis: `${pd.formula}; ${metricOf(pdYear, 'parking_norm').source}`,
    mitigation: { id: 'm-park', kind: 'parking', amount: pd.value, year: phases[0]?.year ?? s.baseYear, label: `+${pd.value} м/м` } })
  if (spill.value > 0) recs.push({ direction: 'Парковки', priority: 'средний', deadline: `до полного заселения (${last.year} г.)`,
    text: `Риск переноса парковки на соседние территории: ${fmt(spill.value)} авто${spill.p90 ? ` (до ${fmt(spill.p90)})` : ''} сверх мест в ЖК — снизить спрос развитием ОТ или предусмотреть перехватывающую стоянку`, basis: spill.source })

  // Торговля
  const rd = metricOf(last, 'retail_def')
  if (rd.value > 0) recs.push({ direction: 'Торговля и услуги', priority: 'средний', deadline: at(phases[0]?.year ?? s.baseYear),
    text: `Зарезервировать помещение или участок под магазин повседневного спроса (не менее ${rd.value} м² торговой площади)${rd.note ? ` — ${rd.note}` : ''}`, basis: `${rd.formula}; ${rd.source}`,
    mitigation: { id: 'm-retail', kind: 'retail', amount: rd.value, year: phases[0]?.year ?? s.baseYear, label: `+${rd.value} м² торговли` } })
  if (metricOf(last, 'pharmacies').value === 0) recs.push({ direction: 'Торговля и услуги', priority: 'средний', deadline: at(phases[0]?.year ?? s.baseYear),
    text: `Зарезервировать помещение под аптеку: в ${c(s, 'retailRadius')} м от ЖК аптек нет`, basis: src(s, 'retailRadius') })

  // Инженерные сети
  // Резерв сетей известен только эксплуатирующим организациям: если введён — сравниваем, иначе вывод не делается
  const nets = [['water', 'вода', 'м³/сут'], ['power', 'электричество', 'кВт'], ['heat', 'тепло', 'кВт']] as const
  const res = project.networkReserve ?? {}
  const over = nets.filter(([k]) => res[k] !== undefined && metricOf(last, k).value > res[k]!)
  const unknownNets = nets.filter(([k]) => res[k] === undefined)
  if (over.length) recs.push({ direction: 'Инженерные сети', priority: 'высокий', deadline: 'до выдачи технических условий',
    text: `Направить на дополнительную инженерную проверку: расчётная потребность превышает известный резерв сети — ${over.map(([k, l, u]) => `${l} ${metricOf(last, k).value} ${u} при резерве ${res[k]} ${u}`).join('; ')}`,
    basis: 'СП 31.13330.2021, СП 256.1325800.2016, СП 124.13330.2012; резерв — введённые данные эксплуатирующих организаций' })
  if (unknownNets.length) recs.push({ direction: 'Инженерные сети', priority: 'средний', deadline: 'до выдачи технических условий',
    text: `Запросить резерв у эксплуатирующих организаций: ${unknownNets.map(([k, l, u]) => `${l} ${fmt(metricOf(last, k).value)} ${u}`).join(', ')}${unknownNets.some(([k]) => k === 'water') ? `, стоки ${fmt(metricOf(last, 'sewer').value)} м³/сут` : ''} — резерв не известен, вывод о достаточности не делается`,
    basis: 'СП 31.13330.2021, СП 256.1325800.2016, СП 124.13330.2012; ТЗ: резерв сетей оценивается только по данным эксплуатирующих организаций' })

  // Данные
  const unknown = last.objects.filter(o => (o.kind === 'kindergarten' || o.kind === 'school') && o.data !== 'факт' && o.data !== 'синтетика')
  if (unknown.length) recs.push({ direction: 'Школы', priority: 'низкий', deadline: 'до следующего пересчёта',
    text: `Запросить проектную мощность и контингент ${unknown.length} объектов образования в зоне доступности (${unknown.slice(0, 4).map(o => o.name).join('; ')}${unknown.length > 4 ? '…' : ''}) — без них дефицит является верхней оценкой`,
    basis: 'требование ТЗ: при отсутствии данных о вместимости не делать вывод о достаточности' })

  const order = { высокий: 0, средний: 1, низкий: 2 }
  return recs.sort((a, b) => order[a.priority] - order[b.priority])
}
