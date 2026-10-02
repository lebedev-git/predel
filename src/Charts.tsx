import { CONTROL_DISTRICT, controlProject } from './data/synthetic'
import { defaultScenario, run, type Phase, type Result, type Scenario, type YearResult } from './model/model'

const W = 360, H = 176, L = 38, R = 10, T = 12, B = 26
const n = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const mv = (h: YearResult, key: string) => h.metrics.find(m => m.key === key)!

/** Потребность в местах по годам: прогноз с полосой P10–P90, норматив и покрытие (места ЖК + резерв района). */
export function DemandChart({ years, keyName, year, phases, mitigated }: { years: YearResult[]; keyName: 'kg' | 'school'; year: number; phases: Phase[]; mitigated?: YearResult[] }) {
  const xs = years.map(h => h.year)
  const scen = years.map(h => mv(h, `${keyName}_scen`))
  const norm = years.map(h => mv(h, `${keyName}_norm`).value)
  const cover = years.map(h => h.cover[keyName])
  const coverM = mitigated?.map(h => h.cover[keyName])
  const top = Math.max(10, ...scen.map(m => m.p90 ?? m.value), ...norm, ...cover.map((c, i) => Math.min(c, (scen[i].p90 ?? scen[i].value) * 1.4))) * 1.1
  const x = (y: number) => L + ((y - xs[0]) / (xs.at(-1)! - xs[0])) * (W - L - R)
  const y = (v: number) => T + (1 - Math.min(v, top) / top) * (H - T - B)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const band = scen.every(m => m.p10 !== undefined)
    ? `${path(scen.map(m => m.p90!))}L${[...scen].reverse().map((m, i) => `${x(xs[xs.length - 1 - i]).toFixed(1)},${y(m.p10!).toFixed(1)}`).join('L')}Z` : ''
  // зона дефицита: между прогнозом и покрытием, где прогноз выше
  const gap = `${path(scen.map((m, i) => Math.max(m.value, cover[i])))}L${[...cover].reverse().map((c, i) => `${x(xs[xs.length - 1 - i]).toFixed(1)},${y(Math.min(c, top)).toFixed(1)}`).join('L')}Z`
  const ticks = [0, 0.5, 1].map(f => Math.round((top * f) / 10) * 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Потребность в местах по годам">
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 5} y={y(t) + 3} className="axis" textAnchor="end">{n(t)}</text></g>)}
      {xs.filter((_, i) => i % 2 === 0).map(v => <text key={v} x={x(v)} y={H - 8} className="axis" textAnchor="middle">{v}</text>)}
      {phases.map(p => <g key={p.name}><line x1={x(p.year)} x2={x(p.year)} y1={T} y2={H - B} className="phase" /><text x={x(p.year) + 3} y={T + 8} className="axis phase-t">{p.name.replace('Очередь ', 'оч. ')}</text></g>)}
      <path d={gap} className="gap" />
      {band && <path d={band} className="band" />}
      <path d={path(norm)} className="norm" />
      <path d={path(cover)} className="cover" />
      {coverM && <path d={path(coverM)} className="cover-m" />}
      <path d={path(scen.map(m => m.value))} className="scen" />
      <line x1={x(year)} x2={x(year)} y1={T - 4} y2={H - B} className="now" />
    </svg>
  )
}

/** Торнадо чувствительности: какое допущение сильнее всего двигает прогноз. */
export function Tornado({ t }: { t: Result['tornado'][number] }) {
  const bars = t.bars.slice(0, 7)
  const max = Math.max(1, ...bars.flatMap(b => [Math.abs(b.low), Math.abs(b.high)]))
  const w = 300, mid = 200, rowH = 22
  return (
    <svg viewBox={`0 0 ${w + 60} ${bars.length * rowH + 10}`} className="chart tornado" role="img" aria-label="Чувствительность прогноза к допущениям">
      <line x1={mid} x2={mid} y1={0} y2={bars.length * rowH} className="grid" />
      {bars.map((b, i) => {
        const sx = (v: number) => mid + (v / max) * 140 * 0.5
        const [a, z] = [Math.min(b.low, b.high), Math.max(b.low, b.high)]
        return (
          <g key={b.key} transform={`translate(0 ${i * rowH})`}>
            <text x={0} y={14} className="axis">{b.label.length > 30 ? b.label.slice(0, 29) + '…' : b.label}</text>
            <rect x={sx(Math.min(0, a))} y={4} width={Math.max(1, sx(Math.max(0, z)) - sx(Math.min(0, a)))} height={13} rx={2} className={z > 0 ? 'tb-hi' : 'tb-lo'} />
            <text x={mid + 76} y={14} className="axis">{a < 0 ? '−' : '+'}{n(Math.abs(a))} … +{n(Math.max(0, z))}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Мировая линейка: сколько школьных мест дал бы этот ЖК по нормам других стран (материалы: мировая практика, §2.1).
 *  Это сравнение методик, а не нормы для Казани: страны считают разное (места или детей, все классы или часть). */
const WORLD: { label: string; per: 'res' | 'apt'; k: number; what: string }[] = [
  { label: 'Москва, старые районы', per: 'res', k: 0.09, what: '2151-ПП, 90 на 1000 жит.' },
  { label: 'Москва, молодые районы', per: 'res', k: 0.124, what: '2151-ПП, 124 на 1000 жит.' },
  { label: 'Санкт-Петербург', per: 'res', k: 0.12, what: 'НГП 2023, 120 на 1000 жит.' },
  { label: 'Пекин', per: 'res', k: 0.083, what: 'норматив 2025, 1–12 кл.' },
  { label: 'Шэньчжэнь', per: 'res', k: 0.12, what: '2025, 1–9 кл.' },
  { label: 'Гонконг', per: 'res', k: 0.0996, what: 'HKPSG, дети 6–17 лет' },
  { label: 'Абу-Даби', per: 'res', k: 0.188, what: 'CFPS, дети 7–17 лет' },
  { label: 'Корея (Кёнги)', per: 'apt', k: 0.425, what: 'ученики 1–9 кл. на квартиру' },
  { label: 'Англия (DfE)', per: 'apt', k: 0.146, what: 'ученики на квартиру' },
  { label: 'США (Нью-Джерси)', per: 'apt', k: 0.148, what: 'дети 5–17 лет, аренда' },
]
export function WorldRuler({ residents, apartments, kazanNorm, forecast }: { residents: number; apartments: number; kazanNorm: number; forecast: number }) {
  const rows = [...WORLD.map(w => ({ label: w.label, what: w.what, v: Math.round(w.k * (w.per === 'res' ? residents : apartments)), own: false })),
    { label: 'Казань, МНГП 2026', what: '47 мест на 10 тыс. м² квартир', v: kazanNorm, own: true }].sort((a, b) => b.v - a.v)
  const max = Math.max(...rows.map(r => r.v), forecast) * 1.05
  const rowH = 17, lw = 150, w = 360
  const x = (v: number) => lw + (v / max) * (w - lw - 44)
  return (
    <svg viewBox={`0 0 ${w} ${rows.length * rowH + 16}`} className="chart ruler" role="img" aria-label="Школьные места по методикам разных стран">
      <line x1={x(forecast)} x2={x(forecast)} y1={0} y2={rows.length * rowH + 2} className="r-fc" />
      {rows.map((r, i) => (
        <g key={r.label} transform={`translate(0 ${i * rowH})`}>
          <title>{r.what}</title>
          <text x={0} y={12} className={`axis${r.own ? ' own' : ''}`}>{r.label}</text>
          <rect x={lw} y={3} width={Math.max(1, x(r.v) - lw)} height={11} rx={2} className={r.own ? 'r-own' : 'r-bar'} />
          <text x={x(r.v) + 4} y={12} className="axis">{r.v.toLocaleString('ru-RU')}</text>
        </g>
      ))}
      <text x={x(forecast)} y={rows.length * rowH + 13} className="axis r-fc-t" textAnchor="middle">прогноз модели {forecast.toLocaleString('ru-RU')}</text>
    </svg>
  )
}

/** Самопроверка по методике ТЗ: контрольный сценарий и стресс-тест считаются тем же ядром при каждом открытии. */
export function ControlCheck() {
  const scen = (patch: Partial<Scenario> = {}): Scenario => ({ ...defaultScenario(), years: 1, pace: [1], cohorts: false, wave: false, samples: 0, ...patch })
  const r = run(CONTROL_DISTRICT, controlProject(), scen())
  const v = (res: Result, key: string) => res.years[0].metrics.find(m => m.key === key)!.value
  const crit = r.years[0].objects.filter(o => o.kind === 'intersection' && o.status === 'crit').length
  const rows: [string, number, number, number][] = [
    ['Жители ЖК', 4650, r.years[0].population, 0], ['Места в ДОО (спрос)', 410, v(r, 'kg_scen'), 0], ['Места в школах (спрос)', 620, v(r, 'school_scen'), 0],
    ['Дефицит ДОО в зоне', 170, v(r, 'kg_def_scen'), 0], ['Дефицит школ в зоне', 240, v(r, 'school_def_scen'), 0],
    ['Авто в утренний пик', 780, v(r, 'car_trips'), 0], ['Поездки на ОТ в пик', 1050, v(r, 'pt_trips'), 0.01], ['Перекрёстков в критической зоне', 2, crit, 0],
  ]
  const big = run(CONTROL_DISTRICT, controlProject(2700), scen())
  const s2 = scen(); s2.coefs.motorization.value = 470
  const moto = run(CONTROL_DISTRICT, controlProject(), s2)
  const s3 = scen(); s3.coefs.occupancy.value = 2.8
  const occ = run(CONTROL_DISTRICT, controlProject(), s3)
  const stress: [string, boolean][] = [
    ['Квартир ×1,5 → дефицит ДОО и поездки растут, рекомендации меняются', v(big, 'kg_def_scen') > v(r, 'kg_def_scen') && v(big, 'car_trips') > v(r, 'car_trips') && big.recommendations.map(x => x.text).join() !== r.recommendations.map(x => x.text).join()],
    ['Заселение 2,8 → жители и места в ДОО растут', occ.years[0].population > r.years[0].population && v(occ, 'kg_scen') > v(r, 'kg_scen')],
    ['Автомобилизация 470 → поездки и перенос парковки растут', v(moto, 'car_trips') > v(r, 'car_trips') && v(moto, 'parking_spill') > v(r, 'parking_spill')],
  ]
  return (
    <div className="control">
      <table className="objs"><thead><tr><th>Пример из ТЗ</th><th>ТЗ</th><th>модель</th><th></th></tr></thead>
        <tbody>{rows.map(([l, e, g, tol]) => { const ok = Math.abs(g - e) <= Math.max(0.5, e * tol); return <tr key={l}><td>{l}</td><td>{e.toLocaleString('ru-RU')}</td><td>{g.toLocaleString('ru-RU')}</td><td className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '✗'}</td></tr> })}
          {stress.map(([l, ok]) => <tr key={l}><td colSpan={3}>{l}</td><td className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '✗'}</td></tr>)}</tbody>
      </table>
      <p className="muted">Норматив МНГП для того же ЖК: {v(r, 'kg_norm')} мест в ДОО и {v(r, 'school_norm')} в школах, {v(r, 'parking_norm').toLocaleString('ru-RU')} машино-мест — пример ТЗ получен сценарием «Типовой», не нормативом. Доли детей и поездки откалиброваны по этому примеру, поэтому совпадение — проверка согласованности с методикой заказчика; независимые проверки — норматив МНГП и стресс-тест.</p>
    </div>
  )
}
