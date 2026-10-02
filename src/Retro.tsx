import { useState } from 'react'
import type { Retro, RetroPoint, RetroSide, RetroSummary } from './model/retro'
import { RETRO_RADIUS } from './model/retro'

// Правая панель режима «Проверка на построенных ЖК» — та же схема, что у прогноза нового ЖК: вывод, карточки на выбранный
// год, график по годам и «как считали». Факт (edu.tatar.ru) есть только на дату данных — на этом году прогноз сравнивается с фактом.

const n = (x: number) => Math.round(x).toLocaleString('ru-RU')
const sign = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%`
const sign1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(x) < 0.1 ? 1 : 0 })}%`
const tone = (e: number) => (Math.abs(e) <= 0.15 ? 'ok' : Math.abs(e) <= 0.35 ? 'warn' : 'crit')
type Side = 'school' | 'kg'

function Card({ title, s, isFact, factYear }: { title: string; s: RetroSide; isFact: boolean; factYear: number }) {
  const full = s.n > 0 && s.missing === 0 && s.fact > 0
  const e = full ? (s.pred - s.fact) / s.fact : 0
  if (!isFact) return (
    <div className="acard t-ok">
      <span className="t">{title}<i>прогноз</i></span>
      <span className="v">{n(s.pred)}<small>детей в зоне</small></span>
      <span className="a">{s.own > 0.5 ? `из этого ЖК ≈ ${n(s.own)} · ` : ''}факт есть только на {factYear} г.</span>
    </div>
  )
  return (
    <div className={`acard t-${full ? tone(e) : 'warn'}`}>
      <span className="t">{title}<i>{full ? (tone(e) === 'ok' ? 'прогноз совпал' : tone(e) === 'warn' ? 'близко' : 'расхождение') : 'неполные данные'}</i></span>
      <span className="v">{full ? sign(e) : '—'}<small>{full ? 'прогноз к факту' : ''}</small></span>
      <span className="a">{full ? `прогноз ${n(s.pred)} · факт ${n(s.fact)}` : `факт есть у ${s.n} из ${s.n + s.missing} учреждений зоны — сравнение ненадёжно`}{s.own > 0.5 ? ` · из этого ЖК ≈ ${n(s.own)}` : ''}</span>
    </div>
  )
}

/** Дети в зоне по годам: прогноз (линия), вклад этого ЖК (заливка), факт на дату данных (точка), выбранный год (вертикаль). */
function RetroChart({ series, side, year, factYear, fact, built }: { series: RetroPoint[]; side: Side; year: number; factYear: number; fact: number; built: number }) {
  const W = 380, H = 150, L = 38, R = 8, T = 10, B = 22
  if (series.length < 2) return null
  const xs = series.map(p => p.year)
  const val = (p: RetroPoint) => (side === 'school' ? p.school : p.kg)
  const own = (p: RetroPoint) => (side === 'school' ? p.ownSchool : p.ownKg)
  const top = Math.max(10, ...series.map(val), fact) * 1.12
  const x = (y: number) => L + ((y - xs[0]) / (xs.at(-1)! - xs[0])) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)},${y(val(p)).toFixed(1)}`).join('')
  const area = `M${x(xs[0])},${y(0)}${series.map(p => `L${x(p.year).toFixed(1)},${y(own(p)).toFixed(1)}`).join('')}L${x(xs.at(-1)!)},${y(0)}Z`
  const ticks = [0, 0.5, 1].map(f => Math.round((top * f) / 10) * 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Дети в зоне по годам: прогноз и факт">
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 5} y={y(t) + 3} className="axis" textAnchor="end">{n(t)}</text></g>)}
      {xs.filter(v => v % 4 === 0 || v === factYear).map(v => <text key={v} x={x(v)} y={H - 6} className="axis" textAnchor="middle">{v}</text>)}
      <line x1={x(built)} x2={x(built)} y1={T} y2={H - B} className="phase" /><text x={x(built) + 3} y={T + 8} className="axis phase-t">ввод ЖК</text>
      <path d={area} className="band" />
      <path d={line} className="scen" />
      {fact > 0 && <><circle cx={x(factYear)} cy={y(fact)} r={4.5} className="fact-dot" /><text x={x(factYear) - 6} y={y(fact) - 7} className="axis" textAnchor="end">факт {n(fact)}</text></>}
      <line x1={x(year)} x2={x(year)} y1={T - 4} y2={H - B} className="now" />
    </svg>
  )
}

// Район по годам: факт по госзаданиям (bus.gov.ru) и edu.tatar.ru до года данных, дальше — прогноз до 2036 г.
// Мерка нехватки — исторический максимум: столько детей здания района уже вмещали (проектных мощностей в открытых данных нет).
// Данные — public/data/nsav-history.json; расчёт — по закреплённым домам (постановление № 791), не по кругу вокруг ЖК.
type Yr = Record<string, number | null>
export interface HistSeries { n: number; fact: Yr; back: Yr; forecast: Yr; lo: Yr; hi: Yr; err: number; naive: number }
export interface DistrictHistory { district: string; base: number; factYear: number; yield: number; school: HistSeries; kg: HistSeries
  perSchool: { name: string; base: number; fact: number; pred: number; err: number; flats: number; yield: number | null }[]; sources: string[]; excluded: string; school107?: SchoolCase }
/** Школа как точка: мощность, закреплённые дома [квартир, год ввода], индексы их зданий на карте, факт учеников. */
export interface SchoolCase { name: string; coords: [number, number]; opened: number; capacity: number; fact: Yr; houses: [number, number][]; buildings: number[]
  addr: number; missing: string[]; yield: [number, number]; flatM2: number; source: string
  before?: { decree: string; school: string; dist: number; stud: number; capEst?: number }; related?: Record<string, string>
  radius?: { r: number; inside: number; outside: number; outsideFlats: number; far: number; others: number; othersFlats: number; mapped: number } }
export const HIST_END = 2036

const pts = (o: Yr, from: number, to: number) => Object.entries(o).map(([k, v]) => [Number(k), v] as const).filter(([k, v]) => v != null && k >= from && k <= to) as [number, number][]
const top1 = (p: [number, number][]) => p.reduce((a, b) => (b[1] > a[1] ? b : a))
const valAt = (s: HistSeries, y: number, factYear: number) => (y <= factYear ? s.fact[y] : s.forecast[y]) ?? 0

function HistChart({ s, base, factYear, year }: { s: HistSeries; base: number; factYear: number; year: number }) {
  const W = 380, H = 170, L = 44, R = 8, T = 12, B = 22, Y0 = base, Y1 = HIST_END
  const fact = pts(s.fact, Y0, factYear), max = top1(fact)
  const all = [...fact, ...pts(s.lo, factYear, Y1), ...pts(s.hi, factYear, Y1)].map(p => p[1])
  const lo = Math.min(...all) * 0.9, top = Math.max(...all) * 1.06
  const x = (y: number) => L + ((y - Y0) / (Y1 - Y0)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (top - lo)) * (H - T - B)
  const path = (p: [number, number][]) => p.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('')
  const hi = pts(s.hi, factYear, Y1), low = pts(s.lo, factYear, Y1)
  const band = `${path(hi)}${low.reverse().map(([a, b]) => `L${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('')}Z`
  const ticks = [lo, (lo + top) / 2, top].map(v => Math.round(v / 100) * 100)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Факт по годам и прогноз до 2036 года">
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 5} y={y(t) + 3} className="axis" textAnchor="end">{n(t)}</text></g>)}
      {[Y0, factYear, 2031, Y1].map(v => <text key={v} x={x(v)} y={H - 6} className="axis" textAnchor="middle">{v}</text>)}
      <line x1={L} x2={W - R} y1={y(max[1])} y2={y(max[1])} className="norm" /><text x={W - R} y={y(max[1]) - 4} className="axis" textAnchor="end">максимум {max[0]} г.</text>
      <path d={band} className="band" />
      <path d={path(pts(s.forecast, factYear, Y1))} className="fwd" />
      <path d={path(fact)} className="scen" />
      {fact.map(([a, b]) => <circle key={a} cx={x(a)} cy={y(b)} r={3} className="fact-dot" />)}
      <line x1={x(factYear)} x2={x(factYear)} y1={T - 4} y2={H - B} className="phase" /><text x={x(factYear) + 3} y={T + 6} className="axis phase-t">сегодня</text>
      <line x1={x(year)} x2={x(year)} y1={T - 4} y2={H - B} className="now" />
    </svg>
  )
}

/** Вывод «будет ли нехватка»: прогноз против того, что район уже вмещал. */
function shortage(s: HistSeries, base: number, factYear: number, what: string) {
  const max = top1(pts(s.fact, base, factYear)), peak = top1(pts(s.forecast, factYear + 1, HIST_END))
  const now = s.fact[factYear] ?? 0, end = s.forecast[HIST_END] ?? 0
  const over = peak[1] > max[1] * 1.01
  return `${what}: ${n(now)} сейчас → ${n(end)} в ${HIST_END} г. (${sign(end / now - 1)}). ${peak[1] > now * 1.005 ? `Пик — ${peak[0]} г., ${n(peak[1])}; больше` : 'Больше'}`
    + ` всего было в ${max[0]} г. — ${n(max[1])}. ${over ? `Прогноз выше уже пройденного на ${n(peak[1] - max[1])}.` : 'Выше уже пройденного уровня не поднимется.'}`
}

const PACE4 = [0.5, 0.8, 0.95, 1] // заселение по годам после ввода — PACE.base (model/coefficients.ts)
const settle = (y: number, from: number) => (y < from ? 0 : PACE4[Math.min(y - from, 3)]) // год ввода 0 (не указан) — дом давно заселён

/** Школа и её дома по годам: сколько учеников нужно домам (модель, диапазон), сколько учится (факт), сколько мест. Ось от нуля, подписи на линиях. */
function SchoolChart({ c, lo, hi, fact, base, factYear, year }: { c: SchoolCase; lo: Yr; hi: Yr; fact: Yr; base: number; factYear: number; year: number }) {
  const W = 380, H = 190, L = 40, R = 74, T = 14, B = 22, Y0 = base, Y1 = HIST_END
  const pl = pts(lo, Y0, Y1), ph = pts(hi, Y0, Y1), pf = pts(fact, Y0, factYear)
  const top = Math.ceil((Math.max(...ph.map(p => p[1]), ...pf.map(p => p[1]), c.capacity) * 1.1) / 1000) * 1000
  const x = (y: number) => L + ((y - Y0) / (Y1 - Y0)) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const path = (p: [number, number][]) => p.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('')
  const band = `${path(ph)}${[...pl].reverse().map(([a, b]) => `L${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('')}Z`
  const ticks = Array.from({ length: top / 1000 + 1 }, (_, i) => i * 1000)
  const [lastY, lastV] = pf.at(-1) ?? [factYear, 0]
  const need = [pl.at(-1)![1], ph.at(-1)![1]], needY = pl.at(-1)![0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Сколько учеников нужно домам гимназии, сколько учится и сколько мест, по годам">
      {c.opened > Y0 && <><rect x={x(Y0)} y={T} width={x(c.opened) - x(Y0)} height={H - T - B} className="pre" /><text x={x(Y0) + 3} y={T + 10} className="axis">за № 143</text></>}
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 5} y={y(t) + 3} className="axis" textAnchor="end">{n(t)}</text></g>)}
      {[Y0, c.opened, factYear, Y1].map(v => <text key={v} x={x(v)} y={H - 6} className="axis" textAnchor="middle">{v}</text>)}
      <path d={band} className="band" />
      <line x1={L} x2={W - R} y1={y(c.capacity)} y2={y(c.capacity)} className="cap" />
      <path d={path(pf)} className="scen" />
      {pf.map(([a, b]) => <circle key={a} cx={x(a)} cy={y(b)} r={3.5} className="fact-dot" />)}
      <line x1={x(year)} x2={x(year)} y1={T - 4} y2={H - B} className="now" />
      <text x={W - R + 4} y={y(c.capacity) + 4} className="lbl cap-t">мест {n(c.capacity)}</text>
      <text x={W - R + 4} y={y((need[0] + need[1]) / 2) - 14} className="lbl need-t">нужно</text>
      <text x={W - R + 4} y={y((need[0] + need[1]) / 2) - 2} className="lbl need-t">в {needY}:</text>
      <text x={W - R + 4} y={y((need[0] + need[1]) / 2) + 10} className="lbl need-t">{n(need[0])}–{n(need[1])}</text>
      {lastV > 0 && <text x={x(lastY) - 6} y={y(lastV) - 7} className="lbl fact-t" textAnchor="end">учатся {n(lastV)}</text>}
    </svg>
  )
}

function SchoolBlock({ h, c, year }: { h: DistrictHistory; c: SchoolCase; year: number }) {
  const F = h.factYear, cap = c.capacity
  const ys = Array.from({ length: HIST_END - h.base + 1 }, (_, i) => h.base + i)
  const D = (y: number) => (y <= F ? h.school.fact[y] : h.school.forecast[y]) ?? 0 // демография — как у школ района
  const flatsAt = (y: number) => c.houses.reduce((a, [f, b]) => a + f * settle(y, b), 0)
  const demand = (k: number): Yr => Object.fromEntries(ys.map(y => [y, Math.round((flatsAt(y) * k * D(y)) / D(F))]))
  const lo = demand(c.yield[0]), hi = demand(c.yield[1])
  const range = (a: number, b: number) => (a === b ? n(a) : `${n(a)}–${n(b)}`)
  const pct = (v: number) => Math.round((v / cap) * 100)
  const before = year < c.opened
  const factY = year <= F ? c.fact[year] ?? null : null
  const v = factY !== null ? [factY, factY] : [lo[year] ?? 0, hi[year] ?? 0]
  // норматив МНГП Казани (табл. 5.1.1.1.1) — от площади квартир, построенных к выбранному году: растёт вместе с кварталами
  const built = c.houses.filter(([, b]) => b <= year).reduce((a, [f]) => a + f, 0)
  const norm = Math.round(((built * c.flatM2) / 1e4) * 47)
  return (
    <>
      <div className="school-head"><b>{c.name}</b><span>кварталы 68–69 · {year} г.</span></div>
      <div className="stats">
        <div className={`stat${!before && v[0] > cap ? ' crit' : ''}`}>
          <span>{before ? 'Нужно мест домам' : factY !== null ? 'Учеников' : 'Учеников, прогноз'}</span>
          <b>{range(v[0], v[1])}</b>
          {!before && <small>{v[0] === v[1] ? pct(v[0]) : `${pct(v[0])}–${pct(v[1])}`}% от мест</small>}
        </div>
        <div className="stat">
          <span>Мест</span>
          <b>{before ? (c.before?.capEst ? `≈ ${n(c.before.capEst)}` : 'нет данных') : n(cap)}</b>
          <small>{before && c.before ? `${c.before.school.replace('школой', 'школа')} в ${n(c.before.dist)} м, за ней до ${c.opened} г. закреплены эти дома и другие; учится ≈ ${n(c.before.stud)}. Оценка мест: 48 кабинетов × 25, одна смена — проектная мощность не опубликована` : `гимназия № 107, проект ${c.opened} г.`}</small>
        </div>
        <div className="stat">
          <span>Норматив</span>
          <b>≈ {n(norm)}</b>
        </div>
      </div>
      <div className="chart-box">
        <div className="chart-head"><b>Сколько нужно мест и сколько учится</b></div>
        <SchoolChart c={c} lo={lo} hi={hi} fact={c.fact} base={h.base} factYear={F} year={year} />
      </div>
      <details className="why">
        <summary><b>Как считали и источники</b></summary>
        <p className="muted">«Нужно» — модель: заселённые квартиры закреплённых домов × {c.yield.map(x => x.toLocaleString('ru-RU', { minimumFractionDigits: 2 })).join('–')} ученика на квартиру × поправка на рождаемость; заселение новых домов 50 / 80 / 95 / 100% по годам. Тот же расчёт по всему району из {h.base} г. дал ошибку {sign1(h.school.err)} на {F} г. {c.source}.</p>
      </details>
    </>
  )
}

export type NsavTab = '107' | 'district'

export function DistrictPanel({ h, year, tab, setTab }: { h: DistrictHistory; year: number; tab: NsavTab; setTab: (t: NsavTab) => void }) {
  const [side, setSide] = useState<Side>('school')
  const s = h[side]
  const card = (k: Side, title: string) => {
    const x = h[k], v = valAt(x, year, h.factYear), max = top1(pts(x.fact, h.base, h.factYear))[1]
    return (
      <button className={`acard-wrap${side === k ? ' on' : ''}`} onClick={() => setSide(k)}>
        <div className={`acard t-${v > max * 1.01 ? 'warn' : 'na'}`}>
          <span className="t">{title}<i>{year <= h.factYear ? 'факт' : 'прогноз'}</i></span>
          <span className="v">{n(v)}<small>{k === 'school' ? 'учеников' : 'детей'} · {year} г.</small></span>
          <span className="a">{year > h.factYear && x.lo[year] !== x.hi[year] ? `диапазон ${n(x.lo[year] ?? 0)}–${n(x.hi[year] ?? 0)} · ` : ''}проверка на истории: ошибка {sign1(x.err)}</span>
        </div>
      </button>
    )
  }
  // Ново-Савиновский: две вкладки — гимназия № 107 (кварталы 68–69, мощность известна) и сводка по району; без данных школы — только сводка
  const tabs = h.school107 && tab === 'district' && ( // в демо — только гимназия № 107; история района — по ?view=nsav, оттуда вкладкой назад
    <nav className="tabs" role="tablist">
      {([['107', 'Гимназия № 107'], ['district', 'История района']] as const).map(([t, l]) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
      ))}
    </nav>
  )
  if (h.school107 && tab === '107') return <>{tabs}<section className="answer"><SchoolBlock h={h} c={h.school107} year={year} /></section></>
  return (
    <>{tabs}<section className="answer">
      <div className="verdict v-ok">
        <b>{h.district}: школы и сады, {h.base}–{HIST_END}</b>
        <span>До {h.factYear} г. — факт, дальше — прогноз. Модель из {h.base} г. предсказала {h.factYear}-й с ошибкой {sign1(h.school.err)} по школам и {sign1(h.kg.err)} по садам</span>
      </div>
      <div className="cards">{card('school', 'Школы')}{card('kg', 'Детские сады')}</div>
      <div className="chart-box">
        <div className="chart-head"><b>{side === 'school' ? 'Ученики школ' : 'Дети в садах'} района, {h.base}–{HIST_END}</b></div>
        <HistChart s={s} base={h.base} factYear={h.factYear} year={year} />
        <p className="muted legend-chart"><span className="lg-fact" />факт <span className="lg-fwd" />прогноз <span className="lg-band" />рождаемость ±10% <span className="lg-max" />максимум за {h.base}–{h.factYear}</p>
      </div>
      <div className="todo">
        <b>Как меняется нагрузка до {HIST_END} г.</b>
        <p>{shortage(h.school, h.base, h.factYear, 'Школы')}</p>
        <p>{shortage(h.kg, h.base, h.factYear, 'Сады')}</p>
        <p className="muted">Хватит ли мест, по району не утверждаем: проектных мощностей в открытых данных нет, а «уже было» — не мощность. Мощность известна у гимназии № 107 — на её вкладке и считаем нехватку. По остальным школам — запрос мощностей в ЦГТ.</p>
      </div>
      <details className="why">
        <summary><b>Источники</b></summary>
        <p className="muted">{h.sources.join('; ')}. {s.n} {side === 'school' ? 'школ' : 'садов'}; {h.excluded}.</p>
      </details>
    </section></>
  )
}

export default function RetroPanel({ r, sum, series, factYear, onExit }: { r: Retro | null; sum: RetroSummary | null; series: RetroPoint[]; factYear: number; onExit: () => void }) {
  const [side, setSide] = useState<Side>('school')
  if (!r) return <section className="answer"><div className="verdict v-warn"><b>Проверка на построенных ЖК</b><span>Кликните по новому дому (голубые) — возьмём его ЖК</span></div></section>
  const isFact = r.year === factYear
  const s = r[side]
  const fs = side === 'school' ? r.school : r.kg
  const factFull = fs.n > 0 && fs.missing === 0
  return (
    <section className="answer">
      <div className={`verdict ${isFact ? 'v-ok' : 'v-warn'}`}>
        <b>{isFact ? `Прогноз против факта · ${r.year}` : `Прогноз модели · ${r.year}`}</b>
        <span>ЖК {r.built[0] === r.built[1] ? `${r.built[0]} г.` : `${r.built[0]}–${r.built[1]} гг.`} · {n(r.flats)} квартир · зона {RETRO_RADIUS} м{isFact ? '' : ` · сравнение с фактом — на ${factYear} г.`}</span>
      </div>
      <div className="cards">
        <button className={`acard-wrap${side === 'school' ? ' on' : ''}`} onClick={() => setSide('school')}><Card title="Школы" s={r.school} isFact={isFact} factYear={factYear} /></button>
        <button className={`acard-wrap${side === 'kg' ? ' on' : ''}`} onClick={() => setSide('kg')}><Card title="Детские сады" s={r.kg} isFact={isFact} factYear={factYear} /></button>
      </div>
      <div className="chart-box">
        <div className="chart-head"><b>{side === 'school' ? 'Школьники' : 'Дети в садах'} в зоне по годам</b></div>
        <RetroChart series={series} side={side} year={r.year} factYear={factYear} fact={factFull ? fs.fact : 0} built={r.built[0]} />
        <p className="muted legend-chart"><span className="lg-scen" />прогноз зоны <span className="lg-band" />из этого ЖК {factFull && <><span className="lg-fact" />факт {factYear}</>}</p>
      </div>
      <div className="why">
        <div className="why-head"><b>Как считали · {r.year} · {side === 'school' ? 'школы' : 'сады'}</b></div>
        <ol className="chain">
          {s.steps.map((st, i) => (
            <li key={i} className={st.label.startsWith('=') ? 'res' : ''}>
              <span className="num">{i + 1}</span>
              <span className="lbl">{st.label}</span>
              <b>{st.unit === '%' ? sign(st.value / 100) : n(st.value)} <small>{st.unit === '%' ? '' : st.unit}</small></b>
              {st.src && <em>{st.src}</em>}
            </li>
          ))}
        </ol>
      </div>
      {sum && sum.zones > 0 && (
        <div className="todo">
          <b>По всем новым ЖК района · {factYear}</b>
          <p>Школы, {sum.zones} зон с полными данными: в сумме {sign(sum.total)}, медиана {sign(sum.median)}, типичная ошибка одной зоны ±{Math.round(sum.typical * 100)}%.</p>
          {sum.kgZones > 0 && <p>Сады ({sum.kgZones} {sum.kgZones % 10 === 1 && sum.kgZones % 100 !== 11 ? 'зона' : [2, 3, 4].includes(sum.kgZones % 10) && ![12, 13, 14].includes(sum.kgZones % 100) ? 'зоны' : 'зон'}): в сумме {sign(sum.kgTotal)}{sum.kgTotal > 0.35 ? ' — модель завышает: типовой состав семей из примера ТЗ даёт больше дошкольников, чем по факту в Казани; в пилоте — калибровка по данным ЦГТ' : ''}.</p>}
          <p className="muted">Факт о контингенте есть у {sum.withFact} из {sum.schools} школ района{sum.withFact < sum.schools * 0.8 ? ' — данных мало, проверка района ненадёжна' : ''}.</p>
        </div>
      )}
      <p className="muted">Балансовая проверка: считаем, что дети зоны учатся в её школах. В отдельной зоне расхождение дают лицеи и гимназии, которые набирают со всего города, и границы закреплённых территорий. В пилоте — сверка по закреплённым территориям и адресам учеников из данных ЦГТ.</p>
      <p className="muted">Шкала внизу: назад — зона до застройки, вперёд — как будет меняться число детей. Клик по другому новому дому (голубые) — его ЖК.</p>
      <button className="link" onClick={onExit}>← Вернуться к прогнозу нового ЖК</button>
    </section>
  )
}
