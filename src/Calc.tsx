import { useEffect, useMemo, useRef, useState } from 'react'
import './Calc.css'
import { calcComplex, cityBase, joinCapacity, steps, SCHOOL_PER_10K, type CalcResult, type Cap, type City, type CitySchool, type Complex, type Phase } from './model/calc'
import { at, demoCity, DEMO_FIT, TRUE } from './model/demo'
import { AGE_STEPS, AZINO_PARAMS, DEFAULT_PARAMS, expected, type House, type Params, type Shift } from './model/forecast'
import type { LngLat } from './model/geo'

/* Калькулятор школ для нового ЖК (?view=calc): задаёте ЖК → формула по шагам → дети против норматива → соседние школы
 * со сменами по годам → сколько мест не хватает. Два города: демо (данные сгенерированы, истина известна) и Казань
 * (150 школ, 520 тыс. квартир, мощности: точно / оценка / нет данных). Работает без интернета: карта своя, без подложки. */

const YEARS = Array.from({ length: 15 }, (_, i) => 2026 + i)
// Прогноз без ЖК привязан к факту. Казань — последний год: школы набирают учеников и меняются, на истории это точнее
// среднего за 2–3 года (freeze.test.ts). Демо-город — среднее за три года: там нет трендов, только шум отчётности.
const ANCHOR: Record<'demo' | 'kazan', number[]> = { demo: [2024, 2025, 2026], kazan: [2026] }
const n = (x: number) => Math.round(x).toLocaleString('ru-RU')
const SHIFT_CLASS: Record<Shift, string> = { 'одна смена': 'ok', 'две смены': 'warn', 'за пределом': 'crit', 'нет данных': 'unk' }
const CAP_HINT: Record<Cap, string> = {
  'точно': 'проектная мощность из новостей мэрии или с сайта школы',
  'оценка': 'оценка по площади здания и году постройки, ошибка в среднем 11%',
  'демо': 'сгенерировано для демо-города',
  'нет данных': 'мощность неизвестна: в дефицит не входит',
}
type Mode = 'demo' | 'kazan'
type Preset = { label: string; coords: LngLat }

interface Loaded { houses: House[]; schools: CitySchool[]; observed: Record<string, Record<number, number>> }
function demoData(): Loaded & { truth: City } {
  const { P, houses, schools, observed } = demoCity(1)
  const cs: CitySchool[] = schools.map(s => ({ ...s, cap: 'демо' }))
  return { houses, schools: cs, observed, truth: { schools: cs, houses, years: YEARS, base: expected(P, TRUE, YEARS) } }
}

export default function Calc() {
  const [mode, setMode] = useState<Mode>('demo')
  const [pkey, setPkey] = useState<'default' | 'azino'>('default')
  const [kazan, setKazan] = useState<Loaded | null>(null)
  const [err, setErr] = useState('')
  const demo = useMemo(() => demoData(), [])
  const params: Params = mode === 'demo' ? DEMO_FIT : pkey === 'azino' ? AZINO_PARAMS : DEFAULT_PARAMS

  useEffect(() => {
    if (mode !== 'kazan' || kazan) return
    Promise.all(['/data/kazan-forecast.json', '/data/kazan-schools.json'].map(u => fetch(u).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${u}: HTTP ${r.status}`))))))
      .then(([f, t]) => setKazan({
        houses: f.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) => ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined })),
        schools: joinCapacity(f.schools, t.schools), observed: f.observed,
      }))
      .catch(e => setErr(String(e.message ?? e)))
  }, [mode, kazan])

  // прогноз без ЖК по всем школам города: ~1 с на Казань, считается один раз на набор параметров
  const [cities, setCities] = useState<Record<string, City>>({})
  const key = `${mode}:${mode === 'demo' ? 'fit' : pkey}`
  const city = cities[key] ?? null
  useEffect(() => {
    const src = mode === 'demo' ? demo : kazan
    if (!src || cities[key]) return
    const t = setTimeout(() => { const c = cityBase(src.houses, src.schools, src.observed, params, YEARS, ANCHOR[mode]); setCities(m => ({ ...m, [key]: c })) }, 30)
    return () => clearTimeout(t)
  }, [key, demo, kazan]) // eslint-disable-line react-hooks/exhaustive-deps

  const presets: Preset[] = useMemo(() => {
    if (mode === 'demo') return [{ label: 'Центр демо-города', coords: at(4, 4) }, { label: 'У новой гимназии № 19', coords: at(7.3, 0.7) }]
    const by = (name: string) => kazan?.schools.find(s => s.name === name)?.coords
    const p107 = by('Гимназия № 107'), p187 = by('Лицей № 187')
    return [...(p107 ? [{ label: 'Условный ЖК у гимназии № 107', coords: [p107[0] + 0.01, p107[1] + 0.004] as LngLat }] : []),
      ...(p187 ? [{ label: 'Условный ЖК в Азино, у лицея № 187', coords: [p187[0] + 0.008, p187[1] - 0.004] as LngLat }] : [])]
  }, [mode, kazan])

  const [spec, setSpec] = useState<Omit<Complex, 'coords'>>({ phases: [{ year: 2027, flats: 600 }, { year: 2029, flats: 600 }, { year: 2031, flats: 600 }], area: 42 }) // 42 м²: средняя квартира домов Казани 2020-х — 39–45 м² (реестр капремонта АИС «ФРТ»)
  const [pts, setPts] = useState<Record<Mode, LngLat | null>>({ demo: null, kazan: null }) // точка ЖК в каждом городе; пока не выбрана — первый пресет
  const [ownOn, setOwnOn] = useState(false)
  const [own, setOwn] = useState({ design: 1100, year: 2031 })
  const [year, setYear] = useState(2035)
  const [wide, setWide] = useState(false) // карта: район ЖК (±4 км) или весь город
  const z: Complex = { ...spec, coords: pts[mode] ?? presets[0]?.coords ?? at(4, 4) }
  const setZ = (f: (v: Complex) => Complex) => { const { coords, ...rest } = f(z); setSpec(rest); setPts(p => ({ ...p, [mode]: coords })) }
  const zc: Complex = ownOn ? { ...z, own } : z

  const res = useMemo(() => (city ? calcComplex(city, zc, params) : null), [city, zc.coords, zc.phases, zc.area, ownOn, own.design, own.year]) // eslint-disable-line react-hooks/exhaustive-deps
  const truth = useMemo(() => (mode === 'demo' ? calcComplex(demo.truth, zc, TRUE) : null), [mode, demo, zc.coords, zc.phases, zc.area, ownOn, own.design, own.year]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPhase = (i: number, patch: Partial<Phase>) => setZ(v => ({ ...v, phases: v.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const t = YEARS.indexOf(year)

  return (
    <div className="calc">
      <header>
        <div className="brand"><span className="mark" aria-hidden>▲</span><div><b>ПРЕДЕЛ</b><small>калькулятор школ для нового ЖК</small></div></div>
        <div className="seg" role="tablist" aria-label="Город">
          <button role="tab" aria-selected={mode === 'demo'} className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>Демо-город</button>
          <button role="tab" aria-selected={mode === 'kazan'} className={mode === 'kazan' ? 'on' : ''} onClick={() => setMode('kazan')}>Казань</button>
        </div>
        <nav className="seg" aria-label="Продукты"><a href="/">Карта</a><a href="/dash/formula.html">Как считаем</a></nav>
      </header>

      <aside className="in">
        <h2>Новый ЖК</h2>
        <label>Где
          <select value={presets.findIndex(p => p.coords[0] === z.coords[0] && p.coords[1] === z.coords[1])} onChange={e => { const p = presets[+e.target.value]; if (p) setZ(v => ({ ...v, coords: p.coords })) }}>
            <option value={-1} disabled>Своя точка на карте</option>
            {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </label>
        <p className="hint">или кликните по карте</p>
        <table className="phases">
          <thead><tr><th>Очередь</th><th>Сдача</th><th>Квартир</th><th /></tr></thead>
          <tbody>{z.phases.map((p, i) => (
            <tr key={i}><td>{i + 1}</td>
              <td><input type="number" min={2026} max={2040} value={p.year} onChange={e => setPhase(i, { year: +e.target.value })} aria-label={`Год сдачи очереди ${i + 1}`} /></td>
              <td><input type="number" min={0} step={50} value={p.flats} onChange={e => setPhase(i, { flats: Math.max(0, +e.target.value) })} aria-label={`Квартир в очереди ${i + 1}`} /></td>
              <td>{z.phases.length > 1 && <button className="x" aria-label={`Убрать очередь ${i + 1}`} onClick={() => setZ(v => ({ ...v, phases: v.phases.filter((_, j) => j !== i) }))}>×</button>}</td></tr>
          ))}</tbody>
        </table>
        <button className="btn" onClick={() => setZ(v => ({ ...v, phases: [...v.phases, { year: Math.min(2040, v.phases.at(-1)!.year + 2), flats: 600 }] }))}>+ очередь</button>
        <label>Средняя площадь квартиры, м²<input type="number" min={20} max={150} value={z.area} onChange={e => setZ(v => ({ ...v, area: +e.target.value }))} /></label>
        <label className="check"><input type="checkbox" checked={ownOn} onChange={e => setOwnOn(e.target.checked)} /> Своя школа в ЖК</label>
        {ownOn && <div className="row2">
          <label>Мест<input type="number" min={100} step={50} value={own.design} onChange={e => setOwn(o => ({ ...o, design: +e.target.value }))} /></label>
          <label>Открытие<input type="number" min={2026} max={2040} value={own.year} onChange={e => setOwn(o => ({ ...o, year: +e.target.value }))} /></label>
        </div>}
        <h2>Модель</h2>
        {mode === 'kazan' ? (
          <div className="seg small" role="tablist" aria-label="Параметры модели">
            <button className={pkey === 'default' ? 'on' : ''} onClick={() => setPkey('default')} title="Город в сумме точнее 2% за 2024–2026">Исходные</button>
            <button className={pkey === 'azino' ? 'on' : ''} onClick={() => setPkey('azino')} title="Подобраны на Азино: по школам точнее, сумму занижают на 5–7%">Подбор Азино</button>
          </div>
        ) : <p className="hint">Параметры подобраны по «факту» демо-города, истина известна.</p>}
        <table className="kpf"><thead><tr><th>Возраст дома, лет</th>{AGE_STEPS.map(a => <th key={a}>{a}</th>)}</tr></thead>
          <tbody><tr><td>Учеников на квартиру</td>{params.kpf.map((k, i) => <td key={i}>{k.toFixed(2).replace('.', ',')}</td>)}</tr>
            {mode === 'demo' && <tr className="truth"><td>Истина</td>{TRUE.kpf.map((k, i) => <td key={i}>{k.toFixed(2).replace('.', ',')}</td>)}</tr>}</tbody></table>
        <p className="hint">Заселено в год сдачи {Math.round(params.pace[0] * 100)}%, через год {Math.round(params.pace[1] * 100)}%. Норматив МНГП Казани: {SCHOOL_PER_10K} мест на 10 000 м² квартир.</p>
      </aside>

      <main>
        {err ? <div className="wait">{err}</div> : !city || !res ? <div className="wait">Считаю прогноз по всем школам города…</div> : (
          <CityMap city={city} res={res} z={zc} t={t} wide={wide} onPick={c => setZ(v => ({ ...v, coords: c }))} />
        )}
        <div className="yearbar">
          <input type="range" min={YEARS[0]} max={YEARS.at(-1)} value={year} onChange={e => setYear(+e.target.value)} aria-label="Год" />
          <b>{year}</b>
          <button className="btn" onClick={() => setWide(w => !w)}>{wide ? 'Район ЖК' : 'Весь город'}</button>
          <span className="keys"><i className="ok" />одна смена <i className="warn" />две смены <i className="crit" />за пределом двух <i className="unk" />нет данных</span>
        </div>
      </main>

      <aside className="out">{res && <Answer res={res} truth={truth} z={zc} params={params} t={t} year={year} mode={mode} />}</aside>
    </div>
  )
}

function Answer({ res, truth, z, params, t, year, mode }: { res: CalcResult; truth: CalcResult | null; z: Complex; params: Params; t: number; year: number; mode: Mode }) {
  const st = steps(z, params, year)
  const peak = res.kids.indexOf(Math.max(...res.kids))
  const area = z.phases.reduce((s, p) => s + p.flats, 0) * z.area
  // школы, куда идут дети ЖК, и соседи, у которых своя школа ЖК забирает детей
  const near = res.schools.filter(s => s.share >= 0.02 || Math.abs(s.load[t] - s.base[t]) >= 20).slice(0, 7)
  const tipping = near.flatMap(s => {
    const y2 = res.years.find((_, k) => s.shift[k] === 'за пределом' && s.shiftBase[k] !== 'за пределом')
    return y2 ? [`${s.name} выходит за предел двух смен в ${y2}`] : []
  })
  const e = res.extra[t]
  return (<>
    <div className="kpis">
      <div className="kpi"><small>Школьников из ЖК в {year}</small><b>{n(res.kids[t])}</b>{truth && <s>истина: {n(truth.kids[t])}</s>}<span>пик {n(res.kids[peak])} в {res.years[peak]}</span></div>
      <div className="kpi"><small>По нормативу, мест</small><b>{n(res.norm[t])}</b><span>{n(area)} м² × {SCHOOL_PER_10K} / 10 000, на весь ЖК {n((area * SCHOOL_PER_10K) / 1e4)}</span></div>
      <div className={`kpi ${e > 0 ? 'bad' : ''}`}><small>{e >= 0 ? 'Не хватает мест из-за ЖК' : 'Своя школа разгружает соседей'}</small><b>{n(Math.abs(e))}</b>{truth && <s>истина: {n(Math.abs(truth.extra[t]))}</s>}<span>детей сверх проектной мощности школ{res.unknown[t] >= 1 ? `; ещё ${n(res.unknown[t])} в школах без данных о мощности` : ''}</span></div>
    </div>
    {tipping.length > 0 && <p className="alert">{tipping.join('; ')}.</p>}

    <h3>Формула, {year}</h3>
    <table className="steps">
      <thead><tr><th>Очередь</th><th>Квартир</th><th>× заселено</th><th>× уч./кв.</th><th>× рожд.</th><th>= детей</th></tr></thead>
      <tbody>{st.map((s, i) => (
        <tr key={i} className={s.age < 0 ? 'future' : ''}><td>{i + 1}: {s.year}<small>{s.age >= 0 ? `дому ${s.age} г.` : 'не сдана'}</small></td><td>{n(s.flats)}</td><td>{Math.round(s.settled * 100)}%</td><td>{s.kpf.toFixed(3).replace('.', ',')}</td><td>{s.cf.toFixed(2).replace('.', ',')}</td><td>{n(s.kids)}</td></tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={5}>Итого детей 7–17 лет</td><td>{n(res.kids[t])}</td></tr></tfoot>
    </table>
    <p className="hint">Учеников на квартиру зависит от возраста дома: в новых домах детей меньше, пик на 10–14-м году. Поправка на рождения: дети 7–17 лет в {year} против 2026 по рождениям в Казани.</p>

    <h3>Дети ЖК против норматива</h3>
    <KidsChart res={res} t={t} />
    <p className="ckeys"><i className="kids" />дети ЖК (модель) <i className="norm" />норматив <i className="extra" />не хватает мест</p>

    <h3>Куда пойдут дети и хватит ли мест</h3>
    <p className="hint">Закрепление за ближайшей школой плюс притяжение соседних (модель Хаффа). Полоса — состояние школы с ЖК по годам.</p>
    <table className="schools">
      <thead><tr><th>Школа</th><th>Мест</th><th>{year}: без ЖК → с ЖК</th></tr></thead>
      <tbody>{near.map(s => (
        <tr key={s.id}>
          <td><b>{s.name}</b> <small>{Math.round(s.share * 100)}% детей ЖК</small>
            <div className="stripe">{s.shift.map((x, k) => <i key={k} className={`${SHIFT_CLASS[x]}${k === t ? ' now' : ''}`} title={`${res.years[k]}: ${n(s.load[k])} уч., ${x}`} />)}</div></td>
          <td><span className={`cap ${s.cap === 'нет данных' ? 'unk' : s.cap === 'оценка' ? 'est' : ''}`} title={CAP_HINT[s.cap]}>{s.design ? n(s.design) : '?'}</span><small>{s.cap}{s.capRange ? ` ${n(s.capRange[0])}–${n(s.capRange[1])}` : ''}</small></td>
          <td>{n(s.base[t])} → <b>{n(s.load[t])}</b><small>{s.shift[t]}</small></td>
        </tr>
      ))}</tbody>
    </table>
    <p className="src">{mode === 'demo'
      ? 'Демо-город: дома, школы, мощности и ученики сгенерированы, параметры модели подобраны по сгенерированному факту. Строка «истина» — расчёт на заложенных параметрах.'
      : 'Казань: дома OSM и реестр капремонта, закрепление kazan.fulledu.ru, ученики 2016–2026 bus.gov.ru и edu.tatar.ru, стройки — реестр Госстройнадзора РТ. Прогноз без ЖК привязан к факту 2026 года.'}</p>
  </>)
}

function KidsChart({ res, t }: { res: CalcResult; t: number }) {
  const W = 400, H = 150, L = 34, R = 8, T = 10, B = 22
  const top = Math.max(10, ...res.kids, ...res.norm) * 1.1
  const x = (k: number) => L + (k / (res.years.length - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const line = (vs: number[]) => vs.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const ticks = [0, 0.5, 1].map(f => Math.round((top * f) / 10) * 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kchart" role="img" aria-label="Дети ЖК и норматив по годам">
      {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 4} y={y(v) + 3} textAnchor="end">{n(v)}</text></g>)}
      {res.years.map((yy, k) => (k % 2 === 0 ? <text key={yy} x={x(k)} y={H - 6} textAnchor="middle">{yy}</text> : null))}
      <path d={line(res.extra.map(v => Math.max(0, v)))} className="extra" />
      <path d={line(res.norm)} className="norm" />
      <path d={line(res.kids)} className="kids" />
      <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="now" />
    </svg>
  )
}

function CityMap({ city, res, z, t, wide, onPick }: { city: City; res: CalcResult; z: Complex; t: number; wide: boolean; onPick: (c: LngLat) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  // своя проекция в км: карта работает без интернета и подложки
  const proj = useMemo(() => {
    const lat0 = city.schools.reduce((s, x) => s + x.coords[1], 0) / city.schools.length
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 111.2
    const xs = city.schools.map(s => s.coords[0] * kx), ys = city.schools.map(s => -s.coords[1] * ky)
    const pad = 1.2, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
    return { kx, ky, x0, y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 }
  }, [city])
  const P = (c: LngLat) => [c[0] * proj.kx - proj.x0, -c[1] * proj.ky - proj.y0]
  const cell = proj.w / 140
  const grid = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of city.houses) {
      const [x, y] = P(h.coords)
      if (x < 0 || y < 0 || x > proj.w || y > proj.h) continue
      const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`
      m.set(k, (m.get(k) ?? 0) + h.flats)
    }
    const max = Math.max(1, ...m.values())
    return [...m].map(([k, f]) => { const [i, j] = k.split(',').map(Number); return { i, j, o: 0.08 + 0.5 * Math.sqrt(f / max) } })
  }, [city, proj]) // eslint-disable-line react-hooks/exhaustive-deps
  const [zx, zy] = P(z.coords)
  const R = 4 // км: полуширина окна «район ЖК»
  const vb = wide ? [0, 0, proj.w, proj.h] : [zx - R * 1.3, zy - R, R * 2.6, R * 2]
  const r = vb[2] / 130
  const pick = (e: React.MouseEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    onPick([(p.x + proj.x0) / proj.kx, -(p.y + proj.y0) / proj.ky])
  }
  const byId = new Map(res.schools.map(s => [s.id, s]))
  return (
    <svg ref={svg} className="map" viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet" onClick={pick} role="img" aria-label="Карта школ: кликните, чтобы поставить ЖК">
      {grid.map(g => <rect key={`${g.i},${g.j}`} x={g.i * cell} y={g.j * cell} width={cell} height={cell} className="house" style={{ opacity: g.o }} />)}
      {res.schools.filter(s => s.share >= 0.02 && s.id !== 'own').map(s => {
        const c = city.schools.find(x => x.id === s.id)!, [sx, sy] = P(c.coords)
        return <line key={s.id} x1={zx} y1={zy} x2={sx} y2={sy} className="flow" strokeWidth={r * (0.15 + 1.4 * s.share)} />
      })}
      {city.schools.map(s => {
        const row = byId.get(s.id)!, [sx, sy] = P(s.coords), load = row.load[t]
        if (s.openYear > res.years[t]) return null
        return <circle key={s.id} cx={sx} cy={sy} r={r * (0.5 + Math.sqrt(load) / 45)} className={`sch ${SHIFT_CLASS[row.shift[t]]}${row.share >= 0.02 ? ' near' : ''}`} style={{ strokeWidth: r * (row.share >= 0.02 ? 0.35 : 0.2) }}>
          <title>{`${s.name}: ${n(load)} учеников в ${res.years[t]}, мест ${row.design ? n(row.design) : '?'} (${row.cap}) — ${row.shift[t]}`}</title></circle>
      })}
      {!wide && city.schools.map(s => {
        const row = byId.get(s.id)!, [sx, sy] = P(s.coords)
        if (row.share < 0.02 || s.openYear > res.years[t]) return null
        return <text key={s.id} x={sx + r * (1 + Math.sqrt(row.load[t]) / 45)} y={sy - r * 0.6} className="sch-t" style={{ fontSize: r * 1.5, strokeWidth: r * 0.35 }}>{s.name?.replace('Школа ', '').replace('Гимназия', 'Гимн.').replace('Лицей', 'Лиц.')}</text>
      })}
      {z.own && (() => { const o = byId.get('own')!; return o.load[t] > 0 && <circle cx={zx} cy={zy} r={r * (0.5 + Math.sqrt(o.load[t]) / 45) + r * 0.6} className={`sch own ${SHIFT_CLASS[o.shift[t]]}`} style={{ strokeWidth: r * 0.5, strokeDasharray: `${r} ${r * 0.6}` }}><title>{`Своя школа ЖК: ${n(o.load[t])} учеников, мест ${n(o.design!)}`}</title></circle> })()}
      <rect x={zx - r * 0.9} y={zy - r * 0.9} width={r * 1.8} height={r * 1.8} className="zhk" style={{ strokeWidth: r * 0.25 }} />
      <text x={zx + r * 1.4} y={zy + r * 0.5} className="zhk-t" style={{ fontSize: r * 2, strokeWidth: r * 0.4 }}>ЖК</text>
    </svg>
  )
}
