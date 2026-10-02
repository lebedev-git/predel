import { KIND_LABEL as COEF_KIND, type CoefKey, type Coefs } from './model/coefficients'
import type { District, Mitigation, Project, Result, Scenario } from './model/model'

interface Props { district: District; project: Project; coefs: Coefs; scenario: Scenario; result: Result; mitigated: Result; mits: Mitigation[] }

/** Печатная версия (window.print → «Сохранить как PDF»): исходные параметры, прогноз, допущения, мероприятия, ограничения. */
export default function Report({ district, project, coefs, scenario, result, mitigated, mits }: Props) {
  const n = (x: number | undefined) => (x === undefined ? '—' : Math.round(x).toLocaleString('ru-RU'))
  const hs = [1, 3, 5, 10].map(k => result.years[k]).filter(Boolean)
  const keys = result.years[0].metrics.map(m => m.key)
  const last = result.years.at(-1)!, lastM = mitigated.years.at(-1)!
  return (
    <div className="report">
      <h1>Предварительная оценка влияния жилой застройки на инфраструктуру района</h1>
      <p>Сформировано: {new Date().toLocaleString('ru-RU')} · Район: {district.name} (данные на {district.dataDate}) · Базовый год {scenario.baseYear}, горизонт {scenario.years} лет</p>

      <h2>1. Исходные параметры проекта</h2>
      <p><b>{project.name}.</b> В составе ЖК: мест в саду — {project.kindergartenSeats}{project.kindergartenSeats ? ` (с ${project.kindergartenYear ?? project.phases[0]?.year} г.)` : ''}, в школе — {project.schoolSeats},
        торговля — {project.retailArea} м², машино-мест — {project.parkingPlanned}, плиты — {project.stoves === 'gas' ? 'газовые' : 'электрические'}.
        {project.residentsOverride ? ` Жителей по проекту: ${n(project.residentsOverride)}.` : ''}
        {project.rooms ? ` Квартиры по комнатности: студии ${Math.round(project.rooms.studio * 100)}%, 1-к ${Math.round(project.rooms.one * 100)}%, 2-к ${Math.round(project.rooms.two * 100)}%, 3-к+ ${Math.round(project.rooms.three * 100)}%.` : ''}
        {` Выездов из ЖК: ${project.exits.length || project.exitCount || 2}.`}
        {` Известный резерв сетей: ${project.networkReserve && Object.values(project.networkReserve).some(v => v !== undefined) ? Object.entries(project.networkReserve).filter(([, v]) => v !== undefined).map(([k, v]) => `${{ water: 'вода', power: 'электричество', heat: 'тепло' }[k]} ${v}`).join(', ') : 'не известен'}.`}</p>
      <table><thead><tr><th>Очередь</th><th>Год ввода</th><th>Квартир</th><th>Общая площадь квартир, м²</th></tr></thead>
        <tbody>{project.phases.map(p => <tr key={p.name}><td>{p.name}</td><td>{p.year}</td><td>{n(p.apartments)}</td><td>{n(p.area)}</td></tr>)}</tbody></table>
      <p>Темп заселения: {scenario.pace.map(x => x.toLocaleString('ru-RU')).join(' → ')}. Волна заселения: {scenario.wave ? 'учитывается' : 'нет'}. Динамика существующих объектов по когортам рождений: {scenario.cohorts ? 'да' : 'нет'}.
        Радиус доступности садов и школ: {scenario.constrained ? 800 : coefs.eduRadius.value} м. Неопределённость: {scenario.samples} прогонов Монте-Карло, seed {scenario.seed}.</p>

      <h2>2. Прогноз по горизонтам (состояние «с ЖК»)</h2>
      <table><thead><tr><th>Возрастная группа, чел.</th>{hs.map(h => <th key={h.year}>{h.year}</th>)}</tr></thead>
        <tbody>{([['k0to6', '0–6 лет'], ['k7to17', '7–17 лет'], ['working', 'трудоспособные'], ['elderly', 'старше трудоспособного']] as const).map(([k, l]) => (
          <tr key={k}><td>{l}</td>{hs.map(h => <td key={h.year}>{n(h.ages[k])}</td>)}</tr>))}</tbody></table>
      <table>
        <thead><tr><th>Показатель</th><th>Основа</th><th>Уверенность</th>{hs.map(h => <th key={h.year}>{h.year}</th>)}</tr></thead>
        <tbody>{keys.map(k => {
          const m0 = result.years[0].metrics.find(m => m.key === k)!
          return (
            <tr key={k}>
              <td>{m0.direction}: {m0.label}, {m0.unit}</td>
              <td>{m0.basis.toLowerCase()}</td>
              <td>{hs.at(-1)!.metrics.find(x => x.key === k)!.confidence ?? '—'}</td>
              {hs.map(h => {
                const m = h.metrics.find(x => x.key === k)!
                return <td key={h.year}>{n(m.value)}{m.p10 !== undefined && m.p10 !== m.p90 ? ` (${n(m.p10)}–${n(m.p90)})` : ''}</td>
              })}
            </tr>
          )
        })}</tbody>
      </table>
      <table className="small"><thead><tr><th>Показатель</th><th>Формула</th><th>Источник</th></tr></thead>
        <tbody>{keys.map(k => { const m0 = result.years.at(-1)!.metrics.find(m => m.key === k)!; return <tr key={k}><td>{m0.label}</td><td>{m0.formula}</td><td>{m0.source}</td></tr> })}</tbody></table>
      <p className="small">В скобках — диапазон P10–P90 (Монте-Карло по диапазонам коэффициентов); уверенность — на последний горизонт. Данные района на {district.dataDate}.</p>

      <h2>3. Перечень мероприятий</h2>
      <table><thead><tr><th>Приоритет</th><th>Мероприятие</th><th>Срок</th><th>Стоимость</th><th>Основание</th></tr></thead>
        <tbody>{result.recommendations.map((r, i) => <tr key={i}><td>{r.priority}</td><td>{r.text}</td><td>{r.deadline}</td><td>{r.cost ? `≈ ${n(r.cost)} млн ₽` : '—'}</td><td className="small">{r.basis}</td></tr>)}</tbody></table>
      <p>Эффект мероприятий ({mits.map(m => m.label).join('; ') || 'не выбраны'}) к {last.year} г.:
        не покрыто мест в садах {n(last.metrics.find(m => m.key === 'kg_def_scen')!.value)} → {n(lastM.metrics.find(m => m.key === 'kg_def_scen')!.value)},
        в школах {n(last.metrics.find(m => m.key === 'school_def_scen')!.value)} → {n(lastM.metrics.find(m => m.key === 'school_def_scen')!.value)},
        перекрёстков в критической зоне {n(last.metrics.find(m => m.key === 'crit_nodes')!.value)} → {n(lastM.metrics.find(m => m.key === 'crit_nodes')!.value)}.</p>

      <h2>4. Объекты в зонах влияния ({last.year} г.)</h2>
      <table><thead><tr><th>Объект</th><th>Расстояние, м</th><th>Без ЖК</th><th>С ЖК</th><th>Данные</th></tr></thead>
        <tbody>{last.objects.filter(o => o.kind !== 'stop').map(o => <tr key={o.id}><td>{o.name}</td><td>{o.distance}</td><td>{o.before === null ? '—' : `${Math.round(o.before * 100)}%`}</td>
          <td>{o.range ? `${Math.round(o.range[0] * 100)}–${Math.round(o.range[1] * 100)}%` : o.after === null ? 'нет данных' : `${Math.round(o.after * 100)}%`}</td><td>{o.data}</td></tr>)}</tbody></table>

      <h2>5. Коэффициенты, формулы и источники</h2>
      <table><thead><tr><th>Коэффициент</th><th>Значение</th><th>Статус</th><th>Источник</th></tr></thead>
        <tbody>{(Object.keys(coefs) as CoefKey[]).map(k => (
          <tr key={k}><td>{coefs[k].label}</td><td>{coefs[k].value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {coefs[k].unit}{coefs[k].range ? ` (${coefs[k].range!.join('–')})` : ''}</td>
            <td>{COEF_KIND[coefs[k].kind]}</td><td className="small">{coefs[k].source}</td></tr>
        ))}</tbody></table>
      <p className="small">Вывод формул и обоснование коэффициентов — docs/МЕТОДИКА.md.</p>
      <h3>Источники данных</h3>
      <ul>{(district.sources ?? []).map(s => <li key={`${s.title}-${s.note ?? ''}`}>{s.title}{s.note ? ` — ${s.note}` : ''}{s.url ? ` (${s.url})` : ''}</li>)}</ul>

      <h2>6. Допущения и ограничения</h2>
      <ul>{result.limitations.map(l => <li key={l}>{l}</li>)}</ul>
    </div>
  )
}
