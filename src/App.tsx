import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import Answer, { type CardKey } from './Answer'
import RetroPanel, { DistrictPanel, HIST_END, type DistrictHistory, type NsavTab } from './Retro'
import { bestSeed, clusterOf, retroCheck, retroSeries, retroSummary, RETRO_RADIUS } from './model/retro'
import { ControlCheck, DemandChart, Tornado, WorldRuler } from './Charts'
import { EMPTY_DISTRICT, EMPTY_SITE, KAZAN_SITE, NSAV_SITE, PROJECT_LABEL, SYNTHETIC_DISTRICT, SYNTHETIC_SITE, buildProject, type ProjectKind } from './data/synthetic'
import { download, importFile, mergeObjects, resultGeoJSON, type Check } from './io'
import MapView, { EDU_COLOR, KIND_LABEL, STATUS_COLOR, STATUS_LABEL, type Camera, type View } from './MapView'
import { DEFAULT_COEFS, DEMOGRAPHY, KIND_LABEL as COEF_KIND, PACE, type CoefKey, type Coefs, type DemographyKey } from './model/coefficients'
import { centroid, type LngLat } from './model/geo'
import { placeFacilities, siteConflict, type Facility } from './model/place'
import { occupancyOf, run, setPhaseApartments, type Direction, type District, type Metric, type ObjectLoad, type Phase, type Project, type Scenario, type YearResult } from './model/model'
import Report from './Report'

type DistrictKey = 'empty' | 'kazan' | 'nsav' | 'synthetic' | 'import'
type Tab = 'summary' | 'metrics' | 'measures' | 'data'
type Edits = Omit<Project, 'site' | 'buildings' | 'name'>
type PKind = ProjectKind | 'import'

const BASE_YEAR = 2026
const n = (x: number | undefined) => (x === undefined ? '—' : Math.round(x).toLocaleString('ru-RU'))
const pct = (x: number | null) => (x === null ? 'нет данных' : `${Math.round(x * 100)}%`)
const mv = (h: YearResult, key: string) => h.metrics.find(m => m.key === key)!
const editsOf = ({ site: _s, buildings: _b, name: _n, ...rest }: Project): Edits => rest
const shift = (p: Project, to: LngLat): Project => {
  const [cx, cy] = centroid(p.site)
  const mv2 = (q: LngLat): LngLat => [q[0] - cx + to[0], q[1] - cy + to[1]]
  return { ...p, site: p.site.map(mv2), buildings: p.buildings.map(b => ({ ...b, footprint: b.footprint.map(mv2) })), exits: p.exits.map(e => ({ ...e, coords: mv2(e.coords) })) }
}
const SLIDERS: { key: CoefKey; min: number; max: number; step: number }[] = [
  { key: 'occupancy', min: 1.8, max: 3.4, step: 0.02 },
  { key: 'motorization', min: 250, max: 550, step: 5 },
  { key: 'share0to6', min: 0.04, max: 0.16, step: 0.002 },
  { key: 'share7to15', min: 0.06, max: 0.18, step: 0.002 },
  { key: 'peakCarShare', min: 0.25, max: 0.55, step: 0.01 },
  { key: 'shareTransit', min: 0.5, max: 1, step: 0.01 },
]
const DASH_URL = '/dash/dash.html' // продукт «Графики» — отдельное приложение (дашборд)
const DIRS: Direction[] = ['Население', 'Детские сады', 'Школы', 'Дороги', 'Общественный транспорт', 'Парковки', 'Торговля и услуги', 'Здравоохранение и спорт', 'Инженерные сети']
const VIEW_LABEL: Record<View, string> = { base: 'Без ЖК', project: 'С ЖК', mitigated: 'С ЖК и мероприятиями' }

export default function App() {
  // глубокая ссылка из дашборда: ?view=107 — гимназия № 107, ?view=nsav — история района, ?view=empty — новый ЖК; без параметра — как раньше
  const [deep] = useState(() => new URLSearchParams(window.location.search).get('view'))
  const [nsavTab, setNsavTab] = useState<NsavTab>(deep === 'nsav' ? 'district' : '107')
  const [dKey, setDKey] = useState<DistrictKey>('empty')
  const [kazan, setKazan] = useState<District | null>(null)
  const [nsav, setNsav] = useState<District | null>(null)
  const [nsavHist, setNsavHist] = useState<DistrictHistory | null>(null) // история и прогноз района по госзаданиям
  const [imported, setImported] = useState<{ district: District; check: Check } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [kind, setKind] = useState<PKind>('big')
  const [importedProject, setImportedProject] = useState<Project | null>(null)
  const [sites, setSites] = useState<Record<DistrictKey, LngLat>>({ empty: EMPTY_SITE, kazan: KAZAN_SITE, nsav: NSAV_SITE, synthetic: SYNTHETIC_SITE, import: KAZAN_SITE })
  const [edits, setEdits] = useState<Record<PKind, Edits>>({ big: editsOf(buildProject('big', KAZAN_SITE)), small: editsOf(buildProject('small', KAZAN_SITE)), import: editsOf(buildProject('big', KAZAN_SITE)) })
  const [coefs, setCoefs] = useState<Coefs>(() => structuredClone(DEFAULT_COEFS))
  const [demo, setDemo] = useState<DemographyKey | 'custom'>('tz')
  const [paceKey, setPaceKey] = useState<keyof typeof PACE>('base')
  const [flags, setFlags] = useState({ wave: false, cohorts: true, constrained: false })
  const [view, setView] = useState<View>('project')
  const [applied, setApplied] = useState<Set<string> | null>(null) // null — все предложенные
  const [yearF, setYearF] = useState(BASE_YEAR + 5)
  const [playing, setPlaying] = useState(false)
  const [tab, setTab] = useState<Tab>('summary')
  const [chartKey, setChartKey] = useState<'kg' | 'school'>('school')
  const [selected, setSelected] = useState<string | null>(null)
  const [moveMode, setMoveMode] = useState(false)
  const [showLeft, setShowLeft] = useState(true)
  const [expert, setExpert] = useState(() => new URLSearchParams(location.search).has('expert')) // «Эксперт» — только по ?expert, в простом виде скрыт
  const [focus, setFocus] = useState<CardKey | null>(null) // открытая карточка: карта показывает то, что к ней относится
  const [params, setParams] = useState(deep === 'empty') // панель «Новый ЖК» поверх карты: на «Новом ЖК» открыта сразу
  const [menu, setMenu] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [retroOn, setRetroOn] = useState(false) // проверка прогноза на построенных ЖК (только реальные районы)
  const [retroSeed, setRetroSeed] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 5000); return () => clearTimeout(t) }, [msg])
  const [camera, setCamera] = useState<Camera | null>(null)
  const [touring, setTouring] = useState(false)
  const tourTimers = useRef<number[]>([])

  useEffect(() => {
    fetch('/data/kazan.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(setKazan)
      .catch(e => { setLoadError(`Данные Казани не загрузились (${e.message}) — открыт контрольный район`); setDKey('synthetic') })
    fetch('/data/kazan-nsav.json').then(r => (r.ok ? r.json() : null)).then(setNsav).catch(() => setNsav(null))
    fetch('/data/nsav-history.json').then(r => (r.ok ? r.json() : null)).then(setNsavHist).catch(() => setNsavHist(null))
  }, [])

  const district: District | null = dKey === 'empty' ? EMPTY_DISTRICT : dKey === 'kazan' ? kazan : dKey === 'nsav' ? nsav : dKey === 'synthetic' ? SYNTHETIC_DISTRICT : imported?.district ?? null
  const project: Project = kind === 'import' && importedProject ? { ...importedProject, ...edits.import } : { ...buildProject(kind === 'import' ? 'big' : kind, sites[dKey]), ...edits[kind] }
  const scenario: Scenario = { baseYear: BASE_YEAR, years: 10, pace: [...PACE[paceKey].pace], coefs, ...flags, samples: 400, seed: 20261001 }

  const calc = useMemo(() => {
    if (!district) return null
    const t = performance.now()
    const result = run(district, project, scenario)
    const proposed = result.recommendations.flatMap(r => (r.mitigation ? [r.mitigation] : []))
    const mits = proposed.filter(m => applied === null || applied.has(m.id))
    const mitigated = run(district, project, { ...scenario, samples: 0 }, mits)
    return { result, mitigated, proposed, mits, ms: performance.now() - t }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, kind, sites, edits, coefs, paceKey, flags, applied, importedProject])

  // проигрывание шкалы времени: ~1,3 с на год (основной прогноз и проверка на построенных ЖК)
  usePlayback(playing, () => setPlaying(false), setYearF, BASE_YEAR + 10)
  const [retroY, setRetroY] = useState(BASE_YEAR)
  const [rPlaying, setRPlaying] = useState(false)

  // что построить: мероприятия → типовые объекты → свободные участки рядом с ЖК (пересчёт только при смене набора)
  const facilities: Facility[] = []
  for (const m of calc?.proposed ?? []) {
    const unit = m.kind === 'kindergarten' ? coefs.kgUnit.value : coefs.schoolUnit.value
    if ((m.kind === 'kindergarten' && m.amount > 150) || (m.kind === 'school' && m.amount >= 0.5 * unit))
      for (let i = 0; i < Math.ceil(m.amount / unit); i++) facilities.push({ id: `${m.id}-${i}`, kind: m.kind, amount: Math.min(unit, m.amount - i * unit), year: m.year, label: m.label })
    else if (m.kind === 'parking') facilities.push({ id: m.id, kind: 'parking', amount: m.amount, year: m.year, label: m.label })
    else if (m.kind === 'retail') facilities.push({ id: m.id, kind: 'shop', amount: m.amount, year: m.year, label: m.label })
  }
  const facKey = JSON.stringify([facilities, project.site[0], dKey, district?.name])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => (district ? placeFacilities(district, project, facilities, centroid(project.site)) : []), [facKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const conflict = useMemo(() => (district ? siteConflict(district, project) : null), [district, project.site[0][0], project.site[0][1]])

  const real = dKey === 'kazan' || dKey === 'nsav'
  const retroActive = (retroOn || dKey === 'nsav') && real && !expert // Ново-Савиновский в простом виде — только история района
  // построенный ЖК: дома, годы шкалы (от двух лет до ввода до +10 лет от даты данных), прогноз по годам
  const retroBase = useMemo(() => {
    if (!retroActive || !district || retroSeed === null) return null
    const cluster = clusterOf(district, retroSeed)
    if (!cluster.length) return null
    const dy = Number(district.dataDate.slice(0, 4))
    const built = Math.min(...cluster.map(i => district.buildings![i][4] || dy))
    const from = Math.max(2005, built - 2), to = dy + 10
    return { cluster, dy, from, to, series: retroSeries(district, cluster, coefs, from, to) }
  }, [retroActive, district, retroSeed, coefs])
  const ry = retroBase ? Math.max(retroBase.from, Math.min(retroBase.to, Math.floor(retroY + 1e-6))) : BASE_YEAR
  const retro = useMemo(() => (retroBase && district ? { cluster: retroBase.cluster, r: retroCheck(district, retroBase.cluster, coefs, RETRO_RADIUS, 'tz', ry)! } : null), [retroBase, district, coefs, ry])
  // новый ЖК для проверки — открываем на годе факта
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (district) setRetroY(Number(district.dataDate.slice(0, 4))) }, [retroSeed])
  usePlayback(rPlaying, () => setRPlaying(false), setRetroY, retroBase?.to ?? BASE_YEAR + 10)
  const hist = retroActive && dKey === 'nsav' ? nsavHist : null // район по годам вместо проверки отдельного ЖК
  const [histY, setHistY] = useState(2026)
  const [hPlaying, setHPlaying] = useState(false)
  usePlayback(hPlaying, () => setHPlaying(false), setHistY, HIST_END)
  const sc = nsavTab === '107' ? hist?.school107 ?? null : null // точка — гимназия № 107 и закреплённые за ней дома (вкладка «История района» — без неё)
  const retroSum = useMemo(() => (retroActive && district ? retroSummary(district, coefs) : null), [retroActive, district, coefs])
  // сменили район в режиме проверки — берём пример из нового района (индексы домов другие)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (retroOn && district?.buildings) setRetroSeed(bestSeed(district, coefs)) }, [district])

  // стартовая страница — Ново-Савиновский (кварталы 68–69), как только загрузились его данные; дальше выбор за пользователем.
  // Хуки — до раннего return: порядок хуков не должен зависеть от загрузки.
  const landed = useRef(deep === 'empty') // ?view=empty — остаёмся на пустой территории, на Ново-Савиновский не перелетаем
  useEffect(() => {
    if (landed.current || !nsav || !nsavHist?.school107) return
    landed.current = true
    if (dKey !== 'empty') return
    setDKey('nsav'); setHistY(nsavHist.factYear)
    setCamera({ key: Math.random(), center: [nsavHist.school107.coords[0], nsavHist.school107.coords[1] + 0.0035], zoom: 14, pitch: 40, bearing: -15, duration: 1400 })
  }, [nsav, nsavHist]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!district || !calc) return <div className="loading"><b>ПРЕДЕЛ</b><span>{loadError || 'Загружаю данные района: здания, дороги, школы и сады Казани…'}</span></div>

  const year = Math.max(BASE_YEAR, Math.min(BASE_YEAR + 10, Math.floor(yearF + 1e-6)))
  const yi = year - BASE_YEAR
  const res = view === 'mitigated' ? calc.mitigated : calc.result
  const h = res.years[yi]
  const hp = calc.result.years[yi]
  const objects: ObjectLoad[] = h.objects
  const radius = flags.constrained ? 800 : coefs.eduRadius.value

  const edit = (patch: Partial<Edits>) => setEdits(e => ({ ...e, [kind]: { ...e[kind], ...patch } }))
  const editPhase = (i: number, patch: Partial<Phase>) => {
    // число квартир меняет площадь и «жителей по проекту» пропорционально — стресс-тест ТЗ через интерфейс
    const p = patch.apartments !== undefined ? setPhaseApartments(project, i, patch.apartments) : { ...project, phases: project.phases.map((x, j) => (j === i ? { ...x, ...patch } : x)) }
    edit({ phases: p.phases, residentsOverride: p.residentsOverride })
  }
  const addPhase = () => {
    const l = project.phases.at(-1)!
    const total = project.phases.reduce((s, x) => s + x.apartments, 0)
    edit({ phases: [...project.phases, { name: `Очередь ${project.phases.length + 1}`, year: l.year + 2, apartments: 500, area: 38_750 }],
      residentsOverride: project.residentsOverride && total ? Math.round((project.residentsOverride * (total + 500)) / total) : project.residentsOverride })
  }
  const removeLast = () => { const q = setPhaseApartments(project, project.phases.length - 1, 0); edit({ phases: q.phases.slice(0, -1), residentsOverride: q.residentsOverride }) }
  const setCoef = (k: CoefKey, value: number) => {
    const d = DEFAULT_COEFS[k]
    // изменённый пользователем коэффициент — это его допущение; исходная норма и источник сохраняются в подписи
    setCoefs(c => ({ ...c, [k]: value === d.value ? { ...d } : { ...c[k], value, kind: 'assumption', source: `изменено пользователем; по умолчанию ${d.value} ${d.unit} — ${d.source}` } }))
    if (k.startsWith('share0') || k.startsWith('share7') || k.startsWith('share16')) setDemo('custom')
  }
  const setDemography = (k: DemographyKey | 'custom') => {
    setDemo(k)
    if (k === 'custom') return
    const d = DEMOGRAPHY[k]
    setCoefs(c => ({ ...c, share0to6: { ...c.share0to6, value: d.share0to6, source: `пресет «${d.label}»: ${d.source}` }, share7to15: { ...c.share7to15, value: d.share7to15, source: `пресет «${d.label}»: ${d.source}` }, share16to17: { ...c.share16to17, value: d.share16to17 } }))
  }
  // плотный район: свободного участка под ЖК-1 нет — показываем ЖК-2 и говорим почему
  const chooseDistrict = (k: DistrictKey) => {
    setDKey(k)
    setParams(k === 'empty'); setFocus(null); setSelected(null); setView('project')
    if (k === 'nsav' && nsavHist?.school107) { setHistY(nsavHist.factYear); setCamera({ key: Math.random(), center: [nsavHist.school107.coords[0], nsavHist.school107.coords[1] + 0.0035], zoom: 14, pitch: 40, bearing: -15, duration: 1400 }) }
    if (k === 'nsav' && kind === 'big') setKind('small') // в «Эксперте» на Ново-Савиновском: свободного участка под ЖК-1 (7,6 га) нет
  }
  // шапка: три продукта; свои два — без перезагрузки (href остаётся для «открыть в новой вкладке» и до загрузки данных)
  const product = dKey === 'nsav' ? '107' : dKey === 'empty' ? 'empty' : null
  const openProduct = (e: React.MouseEvent, v: '107' | 'empty') => {
    if (v === '107' && !(nsav && nsavHist)) return // данных ещё нет — обычный переход по ссылке, после загрузки приземлимся на гимназию
    e.preventDefault()
    setNsavTab('107')
    chooseDistrict(v === '107' ? 'nsav' : 'empty')
    window.history.replaceState(null, '', `?view=${v}`)
  }
  const pickNsavTab = (t: NsavTab) => { setNsavTab(t); window.history.replaceState(null, '', `?view=${t === 'district' ? 'nsav' : '107'}`) }
  const toggleMit = (id: string) => setApplied(a => { const s = new Set(a ?? calc.proposed.map(m => m.id)); if (s.has(id)) s.delete(id); else s.add(id); return s })
  const numIn = (v: string) => (v === '' ? 0 : Number(v))

  async function onImport(file: File) {
    try {
      const r = importFile(await file.text(), file.name)
      if (r.type === 'project') {
        setImportedProject(r.project)
        setEdits(e => ({ ...e, import: editsOf(r.project) }))
        setKind('import')
        const sc = r.scenario
        if (sc) { // сохранённый сценарий: коэффициенты, темп, флаги
          if (sc.coefs) setCoefs(() => {
            const c = structuredClone(DEFAULT_COEFS) as Coefs
            for (const [k, v] of Object.entries(sc.coefs!)) {
              const key = k as CoefKey
              if (key in c && Number.isFinite(v) && v !== c[key].value) c[key] = { ...c[key], value: v, kind: 'assumption', source: `из сохранённого сценария; по умолчанию ${c[key].value}` }
            }
            return c
          })
          const pk = (Object.keys(PACE) as (keyof typeof PACE)[]).find(k => JSON.stringify(PACE[k].pace) === JSON.stringify(sc.pace))
          if (pk) setPaceKey(pk)
          setFlags(f => ({ wave: sc.wave ?? f.wave, cohorts: sc.cohorts ?? f.cohorts, constrained: sc.constrained ?? f.constrained }))
        }
        setMsg(`Загружен ${sc ? 'сценарий' : 'проект'} «${r.project.name}»`)
      } else {
        // таблица без зданий поверх района с 3D-застройкой — уточняет объекты, район и участок остаются
        const m = !r.district.buildings?.length && district?.buildings?.length ? mergeObjects(district, r.district.objects, file.name) : null
        setImported({ district: m ? m.district : r.district, check: r.check })
        const objs = r.district.objects
        setSites(s => ({ ...s, import: m ? s[dKey] : objs.length ? [objs.reduce((a, o) => a + o.coords[0], 0) / objs.length, objs.reduce((a, o) => a + o.coords[1], 0) / objs.length] : KAZAN_SITE }))
        setDKey('import')
        setTab('data')
        setMsg(`${m ? `Уточнено объектов: ${m.matched}, добавлено: ${m.added} — 3D-район сохранён` : `Загружено объектов: ${r.check.ok}`}${r.check.issues.length ? `, замечаний: ${r.check.issues.length}` : ''}`)
      }
    } catch (e) {
      setMsg(`Не удалось загрузить «${file.name}»: ${(e as Error).message}`)
    }
  }

  // Режим показа для питча: общий план → участок → рост ЖК по годам → самый нагруженный объект → мероприятия
  const stopTour = () => { tourTimers.current.forEach(clearTimeout); tourTimers.current = []; setTouring(false); setPlaying(false); setShowLeft(true) }
  const startTour = () => {
    stopTour()
    setTouring(true)
    setShowLeft(false)
    setParams(false)
    setFocus(null)
    setSelected(null)
    const c = centroid(project.site)
    const cam = (zoom: number, pitch: number, bearing: number, duration: number, center: LngLat = c) => setCamera({ key: Math.random(), center, zoom, pitch, bearing, duration })
    const worst = [...calc.result.years.at(-1)!.objects].filter(o => o.kind === 'kindergarten' || o.kind === 'school' || o.kind === 'intersection')
      .sort((a, b) => (b.after ?? 0) - (a.after ?? 0))[0]
    const worstC = worst && district.objects.find(o => o.id === worst.id)?.coords
    const steps: [number, () => void][] = [
      [0, () => { setYearF(BASE_YEAR); cam(14.2, 45, -10, 2500) }],
      [3000, () => cam(15.4, 60, -30, 2500)],
      [5800, () => setPlaying(true)],
      [19500, () => { setPlaying(false); setYearF(BASE_YEAR + 10); if (worst && worstC) { setSelected(worst.id); cam(16.2, 62, 10, 2500, worstC) } }],
      [24500, () => { setSelected(null); cam(15.3, 58, -28, 2500) }],
      [30000, () => { setTouring(false); setShowLeft(true) }],
    ]
    tourTimers.current = steps.map(([t, f]) => window.setTimeout(f, t))
  }

  const sel = selected ? objects.find(o => o.id === selected) : null
  const selSrc = selected ? district.objects.find(o => o.id === selected) : null
  const selP = selected ? hp.objects.find(o => o.id === selected) : null
  const selM = selected ? calc.mitigated.years[yi].objects.find(o => o.id === selected) : null
  const firstDeficit = calc.result.recommendations.filter(r => r.mitigation).map(r => ({ year: r.mitigation!.year, dir: r.direction }))

  return (
    <>
      <div className={`app${expert ? (showLeft ? '' : ' no-left') : ' simple'}`}>
        <header>
          <div className="brand">
            <span className="mark" aria-hidden>▲</span>
            <div><b>ПРЕДЕЛ</b>{expert && <small>прогноз нагрузки жилой застройки на инфраструктуру района</small>}</div>
          </div>
          {expert ? (
            <div className="seg" role="tablist" aria-label="Сценарий">
              {(['base', 'project', 'mitigated'] as View[]).map(v => (
                <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
              ))}
            </div>
          ) : (
            <nav className="seg" aria-label="Продукты">
              <a href={DASH_URL}>Графики</a>
              <a href="?view=107" className={product === '107' ? 'on' : ''} aria-current={product === '107' ? 'page' : undefined} onClick={e => openProduct(e, '107')}>3D: гимназия № 107</a>
              <a href="?view=empty" className={product === 'empty' ? 'on' : ''} aria-current={product === 'empty' ? 'page' : undefined} onClick={e => openProduct(e, 'empty')}>Новый ЖК</a>
            </nav>
          )}
          <div className="actions">
            <input ref={fileRef} type="file" accept=".json,.geojson,.csv" hidden onChange={e => { if (e.target.files?.[0]) onImport(e.target.files[0]); e.target.value = '' }} />
            {expert && <button className="btn primary" onClick={() => setExpert(false)}>Простой вид</button>}
            {expert && dKey !== 'nsav' && <button className={`btn${touring ? ' primary' : ''}`} onClick={() => (touring ? stopTour() : startTour())}>{touring ? 'Остановить показ' : '▶ Показ'}</button>}
            {expert && <button className="btn primary" onClick={() => window.print()}>Отчёт</button>}
            {expert && <div className="more">
              <button className="btn" aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
              {menu && <div className="menu" onClick={() => setMenu(false)}>
                <button onClick={() => fileRef.current?.click()}>Загрузить данные района или проекта</button>
                <button onClick={() => download('scenario.json', { project, scenario: { ...scenario, coefs: Object.fromEntries(Object.entries(coefs).map(([k, v]) => [k, v.value])) }, mitigations: calc.mits })}>Сохранить сценарий</button>
                <button onClick={() => setExpert(e => !e)}>{expert ? 'Простой вид' : 'Режим «Эксперт»: все показатели и допущения'}</button>
              </div>}
            </div>}
          </div>
        </header>
        {(msg || loadError) && <div className="toast" onClick={() => { setMsg(''); setLoadError('') }}>{msg || loadError}</div>}

        <aside className="left">
          <section>
            <h2>Район</h2>
            <select value={dKey} onChange={e => chooseDistrict(e.target.value as DistrictKey)}>
              <option value="empty">Пустая территория (синтетика)</option>
              <option value="kazan" disabled={!kazan}>Казань: Азино и юго-запад Приволжского р-на</option>
                  <option value="nsav" disabled={!nsav}>Казань: Ново-Савиновский район</option>
              <option value="synthetic">Контрольный район (синтетика)</option>
              {imported && <option value="import">{imported.district.name}</option>}
            </select>
            <p className="hint">{district.stats ? `${n(district.stats.buildings)} зданий · ${n(district.stats.flats)} квартир в OSM · ` : ''}данные на {district.dataDate}</p>
          </section>
          {expert && <><section>
            <h2>Проект</h2>
            <select value={kind} onChange={e => setKind(e.target.value as ProjectKind)}>
              {(Object.keys(PROJECT_LABEL) as ProjectKind[]).map(k => <option key={k} value={k}>{PROJECT_LABEL[k]}</option>)}
              {importedProject && <option value="import">{importedProject.name} (загружен)</option>}
            </select>
            <button className={`btn wide${moveMode ? ' primary' : ''}`} onClick={() => setMoveMode(m => !m)}>{moveMode ? 'Кликните по карте — участок переедет туда' : 'Переместить участок'}</button>
            <table className="form">
              <thead><tr><th>№</th><th>Ввод</th><th>Квартир</th><th>Площадь, м²</th><th>Этажей</th></tr></thead>
              <tbody>{project.phases.map((p, i) => (
                <tr key={i}><td>{p.name.replace('Очередь ', '№ ')}</td>
                  <td><input type="number" value={p.year} onChange={e => editPhase(i, { year: numIn(e.target.value) })} /></td>
                  <td><input type="number" value={p.apartments || ''} onChange={e => editPhase(i, { apartments: numIn(e.target.value) })} /></td>
                  <td><input type="number" step={500} value={Math.round(p.area)} onChange={e => editPhase(i, { area: numIn(e.target.value) })} /></td>
                  <td><input type="number" min={1} max={60} value={p.floors ?? ''} placeholder="—" onChange={e => editPhase(i, { floors: e.target.value ? Math.max(1, numIn(e.target.value)) : undefined })} /></td></tr>
              ))}</tbody>
            </table>
            <div className="phase-btns">
              <button className="btn" onClick={addPhase}>+ очередь</button>
              <button className="btn" disabled={project.phases.length < 2} onClick={removeLast}>− очередь</button>
            </div>
            <div className="grid2">
              <label>Жителей по проекту<input type="number" value={project.residentsOverride === undefined ? '' : Math.round(project.residentsOverride)} placeholder="по коэффициенту" onChange={e => edit({ residentsOverride: e.target.value ? Number(e.target.value) : undefined })} /></label>
              <label>Плиты<select value={project.stoves} onChange={e => edit({ stoves: e.target.value as Project['stoves'] })}><option value="electric">электрические</option><option value="gas">газовые</option></select></label>
              <label>Мест в саду ЖК<input type="number" value={project.kindergartenSeats} onChange={e => edit({ kindergartenSeats: numIn(e.target.value) })} /></label>
              <label>…с года<input type="number" value={project.kindergartenYear ?? project.phases[0]?.year} onChange={e => edit({ kindergartenYear: numIn(e.target.value) })} /></label>
              <label>Мест в школе ЖК<input type="number" value={project.schoolSeats} onChange={e => edit({ schoolSeats: numIn(e.target.value) })} /></label>
              <label>…с года<input type="number" value={project.schoolYear ?? project.phases[0]?.year} onChange={e => edit({ schoolYear: numIn(e.target.value) })} /></label>
              <label>Торговля, м²<input type="number" value={project.retailArea} onChange={e => edit({ retailArea: numIn(e.target.value) })} /></label>
              <label>Машино-мест<input type="number" value={project.parkingPlanned} onChange={e => edit({ parkingPlanned: numIn(e.target.value) })} /></label>
              <label>Выездов из ЖК<input type="number" min={1} max={4} value={project.exitCount ?? 2} onChange={e => edit({ exitCount: Math.max(1, Math.min(4, numIn(e.target.value))) })} /></label>
            </div>
            <label>Известный резерв сетей (данные эксплуатирующих организаций)</label>
            <div className="rooms">
              {(['water', 'power', 'heat'] as const).map(k => (
                <label key={k}>{{ water: 'вода, м³/сут', power: 'эл., кВт', heat: 'тепло, кВт' }[k]}
                  <input type="number" min={0} value={project.networkReserve?.[k] ?? ''} placeholder="—"
                    onChange={e => edit({ networkReserve: { ...project.networkReserve, [k]: e.target.value === '' ? undefined : numIn(e.target.value) } })} /></label>
              ))}
            </div>
            <p className="hint">Население: {project.residentsOverride ? `по проекту — ${n(project.residentsOverride)} жит. (× ползунок заселения)` : project.rooms ? `по структуре квартир — ${occupancyOf(project, scenario).toFixed(2)} чел./кв. (× ползунок заселения)` : `по коэффициенту заселения — ${coefs.occupancy.value} чел./кв.`}</p>
            <label>Квартиры по числу комнат, %{project.residentsOverride ? ' — не используется: заданы жители по проекту' : ''}</label>
            <div className="rooms">
              {(['studio', 'one', 'two', 'three'] as const).map(k => (
                <label key={k}>{{ studio: 'студии', one: '1-к', two: '2-к', three: '3-к+' }[k]}
                  <input type="number" min={0} max={100} value={Math.round((project.rooms?.[k] ?? 0) * 100)}
                    onChange={e => edit({ rooms: { studio: 0, one: 0, two: 0, three: 0, ...project.rooms, [k]: numIn(e.target.value) / 100 } })} /></label>
              ))}
            </div>
          </section>
          <section>
            <h2>Допущения</h2>
            <div className="grid2">
              <label>Возрастная структура<select value={demo} onChange={e => setDemography(e.target.value as DemographyKey)}>
                {(Object.keys(DEMOGRAPHY) as DemographyKey[]).map(k => <option key={k} value={k}>{DEMOGRAPHY[k].label}</option>)}
                <option value="custom" disabled>свои значения</option>
              </select></label>
              <label>Темп заселения<select value={paceKey} onChange={e => setPaceKey(e.target.value as keyof typeof PACE)}>
                {(Object.keys(PACE) as (keyof typeof PACE)[]).map(k => <option key={k} value={k}>{PACE[k].label}: {PACE[k].pace.join(' → ')}</option>)}
              </select></label>
            </div>
            <div className="checks">
              <label><input type="checkbox" checked={flags.wave} onChange={e => setFlags(f => ({ ...f, wave: e.target.checked }))} /> Волна заселения (DfE, Англия)</label>
              <label><input type="checkbox" checked={flags.cohorts} onChange={e => setFlags(f => ({ ...f, cohorts: e.target.checked }))} /> Демография района по рождаемости Казани</label>
              <label><input type="checkbox" checked={flags.constrained} onChange={e => setFlags(f => ({ ...f, constrained: e.target.checked }))} /> Стеснённая застройка (радиус 800 м)</label>
            </div>
            {SLIDERS.map(({ key, min, max, step }) => (
              <label key={key} className="slider">
                <span>{coefs[key].label} <b>{coefs[key].value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</b> <small>{coefs[key].unit}</small></span>
                <input type="range" min={min} max={max} step={step} value={coefs[key].value} onChange={e => setCoef(key, Number(e.target.value))} />
              </label>
            ))}
            <details>
              <summary>Все коэффициенты и источники ({Object.keys(coefs).length})</summary>
              <table className="coefs"><tbody>{(Object.keys(coefs) as CoefKey[]).map(k => (
                <tr key={k}>
                  <td>{coefs[k].label}<small>{coefs[k].source}</small></td>
                  <td><input type="number" value={Number(coefs[k].value.toFixed(4))} onChange={e => setCoef(k, Number(e.target.value))} /><small>{coefs[k].unit}</small></td>
                  <td><span className={`badge k-${coefs[k].kind}`}>{COEF_KIND[coefs[k].kind]}</span></td>
                </tr>
              ))}</tbody></table>
              <button className="btn" onClick={() => { setCoefs(structuredClone(DEFAULT_COEFS)); setDemo('tz'); setPaceKey('base') }}>Сбросить</button>
            </details>
          </section></>}
        </aside>

        <main>
          <MapView district={district} project={project} objects={objects} exits={h.exits} placed={placed} coefs={coefs} view={view} yearFloat={view === 'base' ? -Infinity : yearF}
            radius={radius} deficit={{ kg: view !== 'base' && mv(h, 'kg_def_scen').value > 0, school: view !== 'base' && mv(h, 'school_def_scen').value > 0 }} selected={selected} focus={expert ? 'all' : focus}
            retro={hist ? { cluster: [], center: centroid(project.site), radius: 0, year: histY, labels: [], eduAll: true, ...(sc && { cluster: sc.buildings, center: sc.coords, radius: sc.radius?.r ?? 0, eduMark: sc.related }) } : retroActive && retro ? { cluster: retro.cluster, center: retro.r.center, radius: RETRO_RADIUS, year: retroY,
              labels: [...retro.r.school.objects, ...retro.r.kg.objects].map(o => ({ coords: o.coords, text: `${o.name.replace(/^(МБОУ|МАОУ|МБДОУ|МАДОУ)\s*/u, '').replace(/[«»"]/g, '').slice(0, 30)}\nфакт ${o.load!.toLocaleString('ru-RU')}` })) } : null}
            onPickBuilding={i => setRetroSeed(i)}
            moveMode={moveMode} orbit={playing} camera={camera} onPick={p => { if (kind === 'import' && importedProject) setImportedProject(shift(importedProject, p)); else setSites(s => ({ ...s, [dKey]: p })); setMoveMode(false); setSelected(null) }} onSelect={hist ? () => {} : setSelected} />
          {expert && <button className="collapse" onClick={() => setShowLeft(s => !s)} aria-label={showLeft ? 'Скрыть параметры' : 'Показать параметры'}>{showLeft ? '‹' : '›'}</button>}
          {expert ? (
            <div className="legend">
              <div className="legend-row">{(['ok', 'warn', 'crit', 'uncertain', 'unknown'] as const).map(s => <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>)}</div>
              <div className="legend-row muted"><span><i className="plan" />контур — нужно построить, объём — построено</span><span><i className="ring" />{radius} м — сады и школы</span></div>
            </div>
          ) : (
            <>
              {!retroActive && !params && <button className="btn params-btn" onClick={() => setParams(true)}>Новый ЖК</button>}
              {hist ? <div className="legend slim"><div className="legend-row">
                <span><i style={{ background: EDU_COLOR.school }} />школа</span><span><i style={{ background: EDU_COLOR.kindergarten }} />детский сад</span>
                {sc && <><span><i style={{ background: '#1f4fd8' }} />дома гимназии, до {sc.radius?.r ?? 500} м</span><span><i style={{ background: '#9cbcf7' }} />дома гимназии, дальше {sc.radius?.r ?? 500} м</span></>}
              </div></div> : <div className="legend slim"><div className="legend-row">
                {(['ok', 'warn', 'crit', ...(objects.some(o => (view === 'base' ? o.statusBefore : o.status) === 'uncertain') ? ['uncertain' as const] : [])] as const).map(s => <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>)}
              </div></div>}
              {conflict && !hist && <div className="conflict">Участок ЖК задевает {conflict}</div>}
              {params && !retroActive && <div className="params">
                <button className="x" onClick={() => setParams(false)} aria-label="Свернуть">×</button>
                <h2>Новый ЖК</h2>
                {/* территория, пресет, участок, «уже есть в ЖК» и допущения в простом виде не показываем — они остаются в расчёте и в «Эксперте» */}
                <table className="form zhk">
                  <thead><tr><th>№</th><th>Год ввода</th><th>Квартир</th><th /></tr></thead>
                  <tbody>{project.phases.map((p, i) => (
                    <tr key={i}><td>{p.name.replace('Очередь ', '№ ')}</td>
                      <td><input type="number" value={p.year} onChange={e => editPhase(i, { year: numIn(e.target.value) })} /></td>
                      <td><input type="number" value={p.apartments || ''} onChange={e => editPhase(i, { apartments: numIn(e.target.value) })} /></td>
                      <td>{i === project.phases.length - 1 && i > 0 && <button className="del" onClick={removeLast} aria-label="Удалить очередь">×</button>}</td></tr>
                  ))}</tbody>
                </table>
                <div className="phase-btns"><button className="btn" onClick={addPhase}>+ очередь</button>
                  <span className="total-apts">всего {n(project.phases.reduce((a, p) => a + p.apartments, 0))} кв.</span></div>
                <h2 className="gap">Как считаем</h2>
                <ol className="story">
                  <li>Квартиры заселяются не сразу: {scenario.pace.map((x, i) => `${['в год ввода', 'через год', 'через 2 года', 'через 3 года'][i] ?? `через ${i} лет`} — ${Math.round(x * 100)}%`).join(', ')}</li>
                  <li>В квартире живёт в среднем {occupancyOf(project, scenario).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} человека — это коэффициент заселения</li>
                  <li>Из них дети 0–6 лет — {Math.round(coefs.share0to6.value * 100)}%, 7–17 лет — {Math.round((coefs.share7to15.value + coefs.share16to17.value) * 100)}%</li>
                  <li>Сад нужен {Math.round(coefs.kgCoverage.value * 100)}% малышей, школа — {coefs.schoolCoverageLow.value >= 1 ? 'всем' : `${Math.round(coefs.schoolCoverageLow.value * 100)}%`} до 9 класса и {Math.round(coefs.schoolCoverageHigh.value * 100)}% старшеклассников (СП 42)</li>
                  <li>Берём большее из прогноза и норматива на площадь (МНГП), сравниваем со свободными местами в радиусе {radius} м</li>
                </ol>
              </div>}
            </>
          )}
          {sel && selSrc && (
            <div className="card">
              <button className="x" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
              <small>{KIND_LABEL[sel.kind]} · {sel.distance} м от ЖК</small>
              <b>{selSrc.name}</b>
              <div className="flow3">
                <div><small>без ЖК</small><span style={{ color: STATUS_COLOR[sel.statusBefore] }}>{pct(sel.before)}</span></div>
                <div><small>с ЖК</small><span style={{ color: STATUS_COLOR[selP?.status ?? 'unknown'] }}>{selP?.range ? `${Math.round(selP.range[0] * 100)}–${Math.round(selP.range[1] * 100)}%` : pct(selP?.after ?? null)}</span></div>
                <div><small>с мероприятиями</small><span style={{ color: STATUS_COLOR[selM?.status ?? 'unknown'] }}>{pct(selM?.after ?? null)}</span></div>
              </div>
              <p>{sel.kind === 'intersection' ? `+${n(selP?.added)} авт./ч от ЖК${selP?.delay ? `, задержка ×${selP.delay.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} (BPR)` : ''}` : sel.kind === 'stop' ? `+${n(selP?.added)} пасс./ч` : `+${n(selP?.added)} детей из ЖК`} · {year} г.</p>
              {!expert && <p className="src1">Данные: {selSrc.info?.load?.text ?? selSrc.info?.capacity?.text ?? sel.data}</p>}
              {expert && <dl>
                {selSrc.capacity !== undefined && <><dt>Мощность, ед.</dt><dd>{n(selSrc.capacity)}{selSrc.capacityRange ? ` (${n(selSrc.capacityRange[0])}–${n(selSrc.capacityRange[1])})` : ''}</dd></>}
                {selSrc.load !== undefined && <><dt>Загрузка, ед.</dt><dd>{n(selSrc.load)}</dd></>}
                {(['capacity', 'load', 'registry'] as const).map(k => selSrc.info?.[k] && <Fragment key={k}><dt>{{ capacity: 'Мощность', load: 'Загрузка', registry: 'Реестр' }[k]}</dt><dd><span className={`st st-${selSrc.info[k]!.status.replace(' ', '')}`}>{selSrc.info[k]!.status}</span> {selSrc.info[k]!.text}{selSrc.info[k]!.url && <> · <a href={selSrc.info[k]!.url} target="_blank" rel="noreferrer">источник</a></>}</dd></Fragment>)}
                {!selSrc.info && <><dt>Данные</dt><dd><span className="st">{sel.data}</span></dd></>}
              </dl>}
            </div>
          )}
          {hist && <Timeline yearF={histY} setYearF={y => { setHPlaying(false); setHistY(y) }} playing={hPlaying}
            setPlaying={p => { if (p && histY >= HIST_END) setHistY(hist.base); setHPlaying(p) }} from={hist.base} to={HIST_END}
            hl={sc ? [sc.opened, hist.factYear] : [hist.factYear]} hlText={sc ? { [sc.opened]: 'открытие', [hist.factYear]: 'сегодня' } : { [hist.factYear]: 'сегодня' }}
            note={y => (sc && y < sc.opened ? 'гимназии ещё нет — потребность домов' : y <= hist.factYear ? 'факт — госзадания, edu.tatar.ru' : 'прогноз')} marks={[]} phases={[]} />}
          {!hist && retroActive && retroBase && retro && <Timeline yearF={retroY} setYearF={y => { setRPlaying(false); setRetroY(y) }} playing={rPlaying}
            setPlaying={p => { if (p && retroY >= retroBase.to) setRetroY(retroBase.from); setRPlaying(p) }} from={retroBase.from} to={retroBase.to} hl={[retroBase.dy]}
            note={y => (y === retroBase.dy ? 'факт edu.tatar.ru — сравнение' : y < retroBase.dy ? 'прошлое — прогноз модели' : 'прогноз')}
            phases={[{ name: 'ЖК', year: retro.r.built[0], apartments: retro.r.flats, area: 0 }]} marks={[]} population={retro.r.residents} />}
          {!retroActive && <Timeline yearF={yearF} setYearF={y => { setPlaying(false); setYearF(y) }} playing={playing} setPlaying={p => { if (p && yearF >= BASE_YEAR + 10) setYearF(BASE_YEAR); setPlaying(p) }}
            phases={project.phases} marks={firstDeficit} population={view === 'base' ? 0 : h.population} />}
        </main>

        <aside className="right">
          {hist && <DistrictPanel h={hist} year={Math.max(hist.base, Math.min(HIST_END, Math.floor(histY + 1e-6)))} tab={nsavTab} setTab={pickNsavTab} />}
          {retroActive && !hist && <RetroPanel r={retro?.r ?? null} sum={retroSum} series={retroBase?.series ?? []} factYear={retroBase?.dy ?? BASE_YEAR} onExit={() => setRetroOn(false)} />}
          {!expert && !retroActive && <Answer h={h} res={calc.result} mit={calc.mitigated} placed={placed} view={view} open={focus} setOpen={setFocus} phases={project.phases} pace={scenario.pace}
            onFocus={c => setCamera({ key: Math.random(), center: [(c[0] + centroid(project.site)[0]) / 2, (c[1] + centroid(project.site)[1]) / 2], zoom: 15.9, pitch: 58, bearing: -24, duration: 1400 })} />}
          {expert && <>
          <nav className="tabs" role="tablist">
            {([['summary', 'Итог'], ['metrics', 'Показатели'], ['measures', `Мероприятия · ${calc.result.recommendations.length}`], ['data', 'Данные']] as [Tab, string][]).map(([t, l]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
            ))}
          </nav>

          {tab === 'summary' && <Summary h={h} hp={hp} base={calc.result.years[yi]} view={view} res={res} chartKey={chartKey} setChartKey={setChartKey}
            project={project} year={year} calc={calc} goMeasures={() => setTab('measures')} />}

          {tab === 'metrics' && view === 'base' && <p className="note">Состояние «Без ЖК»: нагрузка существующих объектов — на карте и во вкладке «Данные»; ниже — показатели проекта для сравнения.</p>}
          {tab === 'metrics' && (() => {
            const full = calc.result.years.at(-1)!
            return (
              <section className="dir">
                <h3>Этот ЖК по нормам разных стран: школьные места</h3>
                <WorldRuler residents={full.population} apartments={project.phases.reduce((a, p) => a + p.apartments, 0)} kazanNorm={mv(full, 'school_norm').value} forecast={mv(full, 'school_scen').value} />
                <p className="muted">Норматив — выбор политики, а не прогноз: разброс между методиками в 3 раза. Страны считают разное (места или детей, все классы или часть) — это линейка методик, не нормы для Казани. Источник: 10 методик из 6 стран (Россия, Китай, ОАЭ, Корея, Англия, США), первоисточники — в МЕТОДИКЕ, §15.</p>
              </section>
            )
          })()}
          {tab === 'metrics' && DIRS.map(dir => (
            <section key={dir} className="dir">
              <h3>{dir}</h3>
              {h.metrics.filter(m => m.direction === dir).map(m => <MetricRow key={m.key} m={m} date={district.dataDate} />)}
            </section>
          ))}

          {tab === 'measures' && (
            <section>
              <p className="lead">Мероприятия из прогноза {calc.result.years.at(-1)!.year} г. Отметьте, какие включить в сценарий «{VIEW_LABEL.mitigated}».</p>
              {calc.result.recommendations.map((r, i) => {
                const on = r.mitigation && (applied === null || applied.has(r.mitigation.id))
                return (
                  <details key={i} className={`rec p-${r.priority === 'высокий' ? 'hi' : r.priority === 'средний' ? 'mid' : 'lo'}`}>
                    <summary>
                      <span className="rec-head"><span className="prio">{r.priority}</span><span>{r.direction}</span><span>{r.deadline}</span></span>
                      <span className="rec-text">{r.text}</span>
                      {r.cost ? <span className="cost">≈ {n(r.cost)} млн ₽</span> : null}
                    </summary>
                    {r.mitigation && <label className="apply"><input type="checkbox" checked={!!on} onChange={() => toggleMit(r.mitigation!.id)} /> учитывать в сценарии: {r.mitigation.label}</label>}
                    <p><b>Основание:</b> {r.basis}</p>
                  </details>
                )
              })}
              <p className="total">Социальная инфраструктура по отмеченным мероприятиям: <b>≈ {n(calc.result.recommendations.filter(r => r.cost && r.mitigation && (applied === null || applied.has(r.mitigation.id))).reduce((a, r) => a + r.cost!, 0))} млн ₽</b></p>
              <button className="btn primary wide" onClick={() => setView('mitigated')}>Показать сценарий «{VIEW_LABEL.mitigated}»</button>
            </section>
          )}

          {tab === 'data' && <DataTab district={district} h={h} res={calc.result} imported={dKey === 'import' ? imported?.check : undefined} ms={calc.ms}
            exportGeo={() => download(`result-${year}.geojson`, resultGeoJSON(district, project, res, yi))} />}
          </>}
        </aside>
      </div>
      <Report district={district} project={project} coefs={coefs} scenario={scenario} result={calc.result} mitigated={calc.mitigated} mits={calc.mits} />
    </>
  )
}

/** Проигрывание шкалы: год растёт на 1 за ~1,3 с до конца диапазона. */
function usePlayback(playing: boolean, stop: () => void, setY: (f: (y: number) => number) => void, end: number) {
  const raf = useRef(0)
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = (t: number) => {
      const dt = Math.max(0, t - last) // метка rAF бывает раньше performance.now(): отрицательный шаг уводил год за начало шкалы; считаем до setState
      last = t
      setY(y => {
        const next = y + dt / 1300
        if (next >= end) { stop(); return end }
        return next
      })
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, end])
}

function Timeline({ yearF, setYearF, phases, marks, population, from = BASE_YEAR, to = BASE_YEAR + 10, hl, hlText, note }: {
  yearF: number; setYearF: (y: number) => void; playing: boolean; setPlaying: (p: boolean) => void; phases: Phase[]; marks: { year: number; dir: Direction }[]; population?: number
  from?: number; to?: number; hl?: number[]; hlText?: Record<number, string>; note?: (y: number) => string
}) {
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const x = (y: number) => `${((y - from) / (to - from)) * 100}%`
  const year = Math.max(from, Math.min(to, Math.floor(yearF + 1e-6)))
  return (
    <div className="timeline">
      <div className="year"><b>{year}</b><small>{note ? note(year) : year === from ? 'базовый год' : `через ${year - from} ${year - from === 1 ? 'год' : year - from < 5 ? 'года' : 'лет'}`}{population !== undefined && ` · ${Math.round(population).toLocaleString('ru-RU')} жит.`}</small></div>
      <div className="track">
        <div className="gantt">
          {phases.map(p => (
            <div key={p.name} className="bar" style={{ left: x(Math.max(from, p.year - 1)), width: `calc(${x(Math.min(to, p.year + 3))} - ${x(Math.max(from, p.year - 1))})` }}>
              <span>{p.name}: стройка → ввод {p.year} → заселение</span>
            </div>
          ))}
        </div>
        <div className="ticks">{years.map(y => (
          <button key={y} className={`tick${(hl ? hl.includes(y) : [1, 3, 5, 10].includes(y - from)) ? ' h' : ''}${y === year ? ' on' : ''}`} style={{ left: x(y) }} onClick={() => setYearF(y)}>
            {y}{hl ? hl.includes(y) && <small>{hlText?.[y] ?? 'факт'}</small> : [1, 3, 5, 10].includes(y - from) && <small>+{y - from}</small>}
          </button>
        ))}</div>
        {marks.map((m, i) => <i key={i} className="mark-dot" style={{ left: x(m.year) }} title={`${m.dir}: мероприятие к ${m.year}`} />)}
        <input type="range" min={from} max={to} step={0.01} value={yearF} onChange={e => setYearF(Number(e.target.value))} aria-label="Год прогноза" />
        <div className="cursor" style={{ left: x(Math.min(yearF, to)) }} />
      </div>
    </div>
  )
}

function Kpi({ title, value, unit, sub, bad, was }: { title: string; value: string; unit: string; sub: string; bad: boolean; was?: string }) {
  return (
    <div className={`kpi${bad ? ' bad' : ''}`}>
      <small>{title}</small>
      <b>{value}<i>{unit}</i></b>
      {was && <s>{was}</s>}
      <span>{sub}</span>
    </div>
  )
}

function Summary({ h, hp, base, view, res, chartKey, setChartKey, project, year, calc, goMeasures }: {
  h: YearResult; hp: YearResult; base: YearResult; view: View; res: ReturnType<typeof run>; chartKey: 'kg' | 'school'; setChartKey: (k: 'kg' | 'school') => void
  project: Project; year: number; calc: { result: ReturnType<typeof run>; mitigated: ReturnType<typeof run>; ms: number }; goMeasures: () => void
}) {
  const isBase = view === 'base'
  const v = (key: string) => (isBase ? 0 : mv(h, key).value)
  const was = (key: string) => (view === 'mitigated' && mv(hp, key).value !== mv(h, key).value ? `${n(mv(hp, key).value)} без мероприятий` : undefined)
  const pop = mv(hp, 'population')
  const ages = h.ages
  const total = Math.max(1, ages.k0to6 + ages.k7to17 + ages.working + ages.elderly)
  const critBase = base.objects.filter(o => o.kind === 'intersection' && o.statusBefore === 'crit').length
  const eduBefore = (k: 'kindergarten' | 'school') => {
    const os = base.objects.filter(o => o.kind === k)
    const est = os.filter(o => o.statusBefore === 'uncertain' && (o.before ?? 0) > 1).length
    return `перегружено объектов: ${os.filter(o => o.statusBefore === 'crit').length}${est ? ` · по оценке мощности: ${est}` : ''}`
  }
  return (
    <section className="summary">
      <div className="pop">
        <div><b>{isBase ? '0' : n(h.population)}</b><span>жителей ЖК в {year} г.</span></div>
        {!isBase && <small>{pop.p10 !== undefined && pop.p10 !== pop.p90 ? `диапазон по допущениям ${n(pop.p10)}–${n(pop.p90)} · ` : ''}норматив {n(h.populationNorm)} (площадь / 30 м²) · пересчёт {Math.round(calc.ms)} мс</small>}
        {!isBase && <div className="ages" aria-label="Возрастная структура">
          {([['k0to6', '0–6'], ['k7to17', '7–17'], ['working', 'трудосп.'], ['elderly', 'старше']] as const).map(([k, l]) => (
            <span key={k} className={`a-${k}`} style={{ flexGrow: ages[k] / total }} title={`${l}: ${n(ages[k])}`}>{ages[k] / total > 0.12 ? `${l} ${n(ages[k])}` : ''}</span>
          ))}
        </div>}
      </div>
      <div className="kpis">
        <Kpi title="Детские сады" value={n(v('kg_def_scen'))} unit=" мест" bad={v('kg_def_scen') > 0} was={was('kg_def_scen')}
          sub={isBase ? eduBefore('kindergarten') : `не покрыто резервом · норматив ${n(v('kg_def_norm'))}`} />
        <Kpi title="Школы" value={n(v('school_def_scen'))} unit=" мест" bad={v('school_def_scen') > 0} was={was('school_def_scen')}
          sub={isBase ? eduBefore('school') : `не покрыто резервом · норматив ${n(v('school_def_norm'))}`} />
        <Kpi title="Дороги, утренний пик" value={isBase ? n(critBase) : `+${n(v('car_trips'))}`} unit={isBase ? ' узл. z ≥ 1' : ' авт./ч'} bad={v('crit_nodes') > 0 || critBase > 0} was={was('crit_nodes')}
          sub={isBase ? 'перегружено сейчас' : `в критической зоне: ${v('crit_nodes')} узл. · выезд ${n(v('exit_z'))}%`} />
        <Kpi title="Общественный транспорт" value={`+${n(v('pt_trips'))}`} unit=" пасс./ч" bad={v('pt_buses') > 0} sub={`≈ +${v('pt_buses')} рейсов/ч · остановок в 400 м: ${mv(hp, 'stops_near').value}`} />
        <Kpi title="Парковки" value={n(v('parking_def'))} unit=" машино-мест" bad={v('parking_def') > 0 || v('parking_spill') > 0} was={was('parking_def')}
          sub={`дефицит к нормативу · перенос на соседей ${n(v('parking_spill'))} авто`} />
        <Kpi title="Торговля и услуги" value={n(v('retail_def'))} unit=" м²" bad={v('retail_def') > 0} was={was('retail_def')} sub={`не покрыто · аптек в 500 м: ${mv(hp, 'pharmacies').value}`} />
      </div>
      <div className="chart-box">
        <div className="chart-head">
          <b>Места по годам</b>
          <div className="mini-seg">{(['kg', 'school'] as const).map(k => <button key={k} className={chartKey === k ? 'on' : ''} onClick={() => setChartKey(k)}>{k === 'kg' ? 'сады' : 'школы'}</button>)}</div>
        </div>
        <DemandChart years={calc.result.years} keyName={chartKey} year={year} phases={project.phases} mitigated={view === 'mitigated' ? calc.mitigated.years : undefined} />
        <div className="chart-legend"><span className="l-scen">сценарий</span><span className="l-band">P10–P90</span><span className="l-norm">норматив МНГП</span><span className="l-cover">места ЖК + резерв</span>{view === 'mitigated' && <span className="l-cover-m">с мероприятиями</span>}<span className="l-gap">не покрыто</span></div>
      </div>
      <div className="top-recs">
        <b>Главное</b>
        {res.recommendations.length === 0 && <p className="muted">Мероприятий не требуется</p>}
        {calc.result.recommendations.slice(0, 3).map((r, i) => <p key={i}><span className={`dot p-${r.priority === 'высокий' ? 'hi' : 'mid'}`} />{r.text.split(';')[0].split(/\.\s(?=[А-ЯЁ])/)[0]} <small>{r.deadline}</small></p>)}
        <button className="link" onClick={goMeasures}>Все мероприятия и основания →</button>
      </div>
    </section>
  )
}

function MetricRow({ m, date }: { m: Metric; date: string }) {
  return (
    <details className="metric">
      <summary>
        <span>{m.label}</span>
        <b>{n(m.value)} <small>{m.unit}</small></b>
        <span className={`badge b-${m.basis === 'Норматив' ? 'norm' : m.basis === 'Факт' ? 'fact' : 'scen'}`}>{m.basis.toLowerCase()}</span>
      </summary>
      {m.p10 !== undefined && <p><b>Диапазон по допущениям:</b> {n(m.p10)}–{n(m.p90)} {m.unit} (P10–P90)</p>}
      {m.confidence && <p><b>Уверенность:</b> {m.confidence}</p>}
      {m.note && <p className="note">{m.note}</p>}
      <p><b>Формула:</b> {m.formula}</p>
      <p><b>Исходные и источник:</b> {m.source}</p>
      <p><b>Актуальность:</b> данные района на {date}; нормативы — в редакции, указанной в источнике</p>
    </details>
  )
}

function DataTab({ district, h, res, imported, ms, exportGeo }: { district: District; h: YearResult; res: ReturnType<typeof run>; imported?: Check; ms: number; exportGeo: () => void }) {
  const counts = h.objects.reduce<Record<string, number>>((a, o) => ((a[o.data] = (a[o.data] ?? 0) + 1), a), {})
  return (
    <section className="data">
      <h3>Проверка на примере из ТЗ и стресс-тест</h3>
      <ControlCheck />
      <h3>Источники · данные на {district.dataDate}</h3>
      <ul className="sources">{(district.sources ?? []).map(s => <li key={`${s.title}-${s.note ?? ''}`}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}{s.note && <small>{s.note}</small>}</li>)}</ul>
      <p className="statuses">{Object.entries(counts).map(([k, v]) => <span key={k} className={`st st-${k.replace(' ', '')}`}>{k}: {v}</span>)}</p>
      {imported && <div className="check"><b>Проверка загрузки:</b> объектов {imported.ok}
        <ul>{Object.entries(imported.byKind).map(([k, v]) => <li key={k}>{KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k}: {v.n}{v.noCap ? `, без мощности ${v.noCap}` : ''}{v.noLoad ? `, без загрузки ${v.noLoad}` : ''}</li>)}</ul>
        {imported.issues.length > 0 && <details><summary>Замечания ({imported.issues.length})</summary><ul>{imported.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
      </div>}
      {res.tornado.map(t => <Fragment key={t.metric}>
        <h3>Чувствительность: {t.metric.toLowerCase()}, {t.year} г. (база {n(t.base)})</h3>
        <Tornado t={t} />
      </Fragment>)}
      <h3>Объекты в зонах влияния, {h.year} г.</h3>
      <table className="objs"><thead><tr><th>Объект</th><th>м</th><th>без ЖК</th><th>с ЖК</th></tr></thead>
        <tbody>{h.objects.filter(o => o.kind !== 'stop').map(o => (
          <tr key={o.id}><td><i style={{ background: STATUS_COLOR[o.status] }} />{o.name}<small>{KIND_LABEL[o.kind]} · {o.data}</small></td><td>{o.distance}</td>
            <td>{pct(o.before)}</td><td>{o.range ? `${Math.round(o.range[0] * 100)}–${Math.round(o.range[1] * 100)}%` : pct(o.after)}</td></tr>
        ))}</tbody>
      </table>
      <h3>Ограничения</h3>
      <ul className="limits">{res.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      <button className="btn wide" onClick={exportGeo}>Выгрузить результат в GeoJSON (для цифрового двойника)</button>
      <p className="muted">Пересчёт: {ms.toFixed(0)} мс · три состояния × 11 лет, Монте-Карло 400 прогонов</p>
    </section>
  )
}

