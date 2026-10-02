import { useState } from 'react'
import type { LngLat } from './model/geo'
import { paceShare, type Metric, type Phase, type Recommendation, type Result, type Step, type YearResult } from './model/model'
import type { Placed } from './model/place'
import type { View } from './MapView'

// Слой 1 «Ответ» и слой 2 «Почему так»: один вывод, шесть карточек, по клику — цепочка расчёта из ядра.

const n = (x: number) => Math.round(x).toLocaleString('ru-RU')
const FAC = { kindergarten: 'Детский сад', school: 'Школа', parking: 'Паркинг', shop: 'Магазин' }
export const plural = (x: number, one: string, few: string, many: string) => (x % 10 === 1 && x % 100 !== 11 ? one : [2, 3, 4].includes(x % 10) && ![12, 13, 14].includes(x % 100) ? few : many)
const mv = (h: YearResult, key: string) => h.metrics.find(m => m.key === key)!

type Tone = 'ok' | 'warn' | 'crit'
export type CardKey = 'kg' | 'school' | 'roads' | 'parking' | 'shop'
type Key = CardKey
interface Card { key: Key; title: string; tone: Tone; badge: string; value: string; unit: string; action: string; chains: { label: string; m: Metric }[]; place?: Placed[]; rec?: Recommendation }

function cards(h: YearResult, res: Result, placed: Placed[], view: View): Card[] {
  const rec = (dir: string) => res.recommendations.find(r => r.direction === dir && r.mitigation)
  const edu = (key: 'kg' | 'school', title: string, kind: 'kindergarten' | 'school'): Card => {
    const scen = mv(h, `${key}_def_scen`), norm = mv(h, `${key}_def_norm`)
    const need = Math.max(scen.value, norm.value)
    const pl = placed.filter(p => p.kind === kind)
    const word = kind === 'kindergarten' ? plural(pl.length, 'сад', 'сада', 'садов') : plural(pl.length, 'школа', 'школы', 'школ')
    const action = pl.length ? `${pl.length} ${word} по ${n(pl[0].amount)} ${plural(Math.round(pl[0].amount), 'место', 'места', 'мест')} к ${pl[0].year}` : rec(title) ? 'места в ЖК или пристрой' : 'строить не нужно'
    const first = scen.value >= norm.value ? [{ label: 'по прогнозу', m: scen }, { label: 'по нормативу', m: norm }] : [{ label: 'по нормативу', m: norm }, { label: 'по прогнозу', m: scen }]
    return { key, title, tone: need > 0 ? 'crit' : 'ok', badge: need > 0 ? 'не хватает' : 'хватает', value: need > 0 ? `−${n(need)}` : '0', unit: 'мест',
      action: view === 'mitigated' && need === 0 && pl.length ? 'закрыто новыми объектами' : action, chains: first, place: pl, rec: rec(title) }
  }
  const pd = mv(h, 'parking_def'), pt = mv(h, 'pt_buses'), cars = mv(h, 'car_trips'), crit = mv(h, 'crit_nodes'), rd = mv(h, 'retail_def')
  const pk = placed.filter(p => p.kind === 'parking'), sh = placed.filter(p => p.kind === 'shop')
  const node = h.objects.filter(o => o.kind === 'intersection' && o.added > 0 && o.after !== null).sort((a, b) => b.after! - a.after!)[0]
  return [
    edu('kg', 'Детские сады', 'kindergarten'),
    edu('school', 'Школы', 'school'),
    { key: 'roads', title: 'Дороги и автобусы', tone: crit.value > 0 ? 'crit' : (node && node.after! >= 0.7) || pt.value > 0 ? 'warn' : 'ok',
      badge: crit.value > 0 ? 'пробка' : node && node.after! >= 0.7 ? 'на пределе' : pt.value > 0 ? 'нужны рейсы' : 'в норме',
      value: node ? `${Math.round(node.after! * 100)}%` : '—', unit: 'загрузка узла', action: `машин в час пик: +${n(cars.value)} · ${pt.value > 0 ? `+${n(pt.value)} рейсов` : 'автобусов хватает'}`,
      chains: [{ label: 'узлы', m: crit }, { label: 'машины', m: cars }, { label: 'автобусы', m: pt }], rec: rec('Дороги') ?? rec('Общественный транспорт') },
    { key: 'parking', title: 'Парковки', tone: pd.value > 0 ? 'crit' : 'ok', badge: pd.value > 0 ? 'не хватает' : 'хватает', value: pd.value > 0 ? `−${n(pd.value)}` : '0', unit: 'машино-мест',
      action: pk.length ? `паркинг на ${n(pk[0].amount)} ${plural(Math.round(pk[0].amount), 'машино-место', 'машино-места', 'машино-мест')} к ${pk[0].year}` : 'строить не нужно', chains: [{ label: 'по нормативу', m: pd }], place: pk, rec: rec('Парковки') },
    { key: 'shop', title: 'Торговля и ТЦ', tone: rd.value > 0 ? 'crit' : 'ok', badge: rd.value > 0 ? 'не хватает' : 'хватает', value: rd.value > 0 ? `−${n(rd.value)}` : '0', unit: 'м² торговли',
      action: sh.length ? `магазин на ${n(sh[0].amount)} м² к ${sh[0].year}` : 'строить не нужно', chains: [{ label: 'по нормативу', m: rd }], place: sh, rec: rec('Торговля и услуги') },
  ]
}

/** Вывод на весь горизонт: когда ЖК упирается в предел и что с этим делать. */
function verdict(res: Result, mit: Result, placed: Placed[], view: View) {
  const need = (h: YearResult) => Math.max(mv(h, 'kg_def_scen').value, mv(h, 'kg_def_norm').value) + Math.max(mv(h, 'school_def_scen').value, mv(h, 'school_def_norm').value)
  const first = res.years.find(h => need(h) > 0)?.year
  const kg = placed.filter(p => p.kind === 'kindergarten').length, sc = placed.filter(p => p.kind === 'school').length
  const cost = res.recommendations.filter(r => r.cost).reduce((a, r) => a + r.cost!, 0)
  const last = Math.max(0, ...placed.filter(p => p.kind !== 'shop').map(p => p.year))
  const what = [kg && `${kg} ${plural(kg, 'сад', 'сада', 'садов')}`, sc && `${sc} ${plural(sc, 'школа', 'школы', 'школ')}`, placed.some(p => p.kind === 'parking') && 'паркинг'].filter(Boolean).join(', ')
  if (view === 'base') return { tone: 'ok' as Tone, title: 'Район без нового ЖК', sub: 'Цвет зданий школ и садов на карте — их загрузка сегодня' }
  if (!first) return { tone: 'ok' as Tone, title: 'Садов и школ хватает', sub: 'Свободных мест рядом достаточно на весь горизонт' }
  if (view === 'mitigated') {
    const closed = mit.years.find((_, i) => mit.years.slice(i).every(x => need(x) === 0))?.year
    if (closed === mit.years[0].year) return { tone: 'ok' as Tone, title: 'С мерами дефицита нет', sub: 'Меры вводятся к нужному году' }
    return { tone: 'ok' as Tone, title: closed ? `С мерами дефицит закрыт с ${closed} года` : 'Мер недостаточно', sub: closed && closed > first ? `${first}–${closed - 1}: временные группы и подвоз — новый объект быстрее не построить` : 'Новые объекты вводятся к нужному году' }
  }
  return { tone: 'crit' as Tone, title: `ЖК упирается в предел в ${first} году`, sub: `Решение: ${what || 'места в ЖК'}${last ? ` к ${last} году` : ''}${cost ? `, около ${(cost / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд ₽` : ''}` }
}

function Chain({ steps }: { steps: Step[] }) {
  return (
    <ol className="chain">
      {steps.map((s, i) => (
        <li key={i} className={s.label.startsWith('=') ? 'res' : ''}>
          <span className="num">{i + 1}</span>
          <span className="lbl">{s.label}</span>
          <b>{n(s.value)} <small>{s.unit === 'м/м' ? 'машино-мест' : s.unit}</small></b>
          {s.src && <em>{s.src}</em>}
        </li>
      ))}
    </ol>
  )
}

/** Как заселяется ЖК в выбранном году: доля заселённых квартир по очередям (темп заселения), жители и дети из метрик года. */
function Settle({ h, phases, pace }: { h: YearResult; phases: Phase[]; pace: readonly number[] }) {
  return (
    <div className="settle">
      <h2>{h.year}: как заселяется ЖК</h2>
      {phases.map((p, i) => {
        const s = paceShare(pace, h.year - p.year)
        return (
          <div key={i} className="ph">
            <span>{p.name}<small>{n(p.apartments)} кв. · ввод {p.year}</small></span>
            <i><em style={{ width: `${s * 100}%` }} /></i>
            <b>{h.year < p.year ? 'строится' : `${Math.round(s * 100)}%`}</b>
          </div>
        )
      })}
      <p className="tot"><b>{n(h.population)}</b> жителей · детей 0–6 лет <b>{n(h.ages.k0to6)}</b> · 7–17 лет <b>{n(h.ages.k7to17)}</b></p>
    </div>
  )
}

export default function Answer({ h, res, mit, placed, view, open, setOpen, onFocus, onExpert, phases, pace }: {
  h: YearResult; res: Result; mit: Result; placed: Placed[]; view: View; open: CardKey | null; setOpen: (k: CardKey | null) => void; onFocus: (c: LngLat) => void; onExpert?: () => void
  phases: Phase[]; pace: readonly number[]
}) {
  const [chain, setChain] = useState(0)
  const v = verdict(res, mit, placed, view)
  const cs = cards(h, res, placed, view)
  const sel = cs.find(c => c.key === open)
  return (
    <section className="answer">
      <div className={`verdict v-${v.tone}`}><b>{v.title}</b><span>{v.sub}</span></div>
      {view !== 'base' && <>
        <Settle h={h} phases={phases} pace={pace} />
        <h2 className="need-h">Чего не хватает к {h.year}</h2>
        <div className="cards">
          {cs.map(c => (
            <button key={c.key} className={`acard t-${c.tone}${open === c.key ? ' on' : ''}`} onClick={() => { setOpen(open === c.key ? null : c.key); setChain(0); if (c.place?.[0]) onFocus(c.place[0].center) }}>
              <span className="t">{c.title}<i>{c.badge}</i></span>
              <span className="v">{c.value}<small>{c.unit}</small></span>
              <span className="a">{c.action}</span>
            </button>
          ))}
          <div className="acard t-soon"><span className="t">Общественные пространства<i>скоро</i></span><span className="a">расчёт в следующей версии</span></div>
        </div>
        {sel && (
          <div className="why">
            <div className="why-head">
              <b>Почему так · {h.year} год</b>
              {sel.chains.length > 1 && <div className="mini-seg">{sel.chains.map((c, i) => <button key={c.label} className={chain === i ? 'on' : ''} onClick={() => setChain(i)}>{c.label}</button>)}</div>}
            </div>
            {sel.chains[chain]?.m.steps?.length ? <Chain steps={sel.chains[chain].m.steps!} /> : <p className="muted">{sel.chains[chain]?.m.formula}</p>}
            {sel.chains[chain]?.m.note && <p className="note">{sel.chains[chain].m.note}</p>}
            {sel.place?.length ? (
              <div className="todo">
                <b>Что построить</b>
                {sel.place.map(p => (
                  <p key={p.id}>{FAC[p.kind]} на {n(p.amount)} {p.kind === 'shop' ? 'м²' : p.kind === 'parking' ? plural(Math.round(p.amount), 'машино-место', 'машино-места', 'машино-мест') : plural(Math.round(p.amount), 'место', 'места', 'мест')}, ввод {p.year}: участок {(p.plotArea / 10_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} га по СП 42 —{' '}
                    {p.inRadius ? `свободное место найдено в ${n(p.dist)} м от ЖК` : p.found ? `в нормативном радиусе места нет — ближайший свободный участок в ${n(p.dist)} м` : 'свободного места рядом нет (здания, улицы, вода, парки): нужен выкуп или реорганизация территории'}</p>
                ))}
                {sel.rec?.cost ? <p>Стоимость: около {n(sel.rec.cost)} млн ₽</p> : null}
              </div>
            ) : sel.rec ? <div className="todo"><b>Что сделать</b><p>{sel.rec.text.split(';')[0]}</p></div> : null}
          </div>
        )}
      </>}
      {onExpert && <button className="link" onClick={onExpert}>Все показатели, сети, допущения и источники — режим «Эксперт» →</button>}
    </section>
  )
}
