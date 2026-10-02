import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coefs } from './model/coefficients'
import { centroid, circle, distance, type LngLat } from './model/geo'
import type { District, ExitLoad, ObjectLoad, ObjKind, Project, Status } from './model/model'
import type { Placed } from './model/place'
import { plural } from './Answer'
import { facilityModel } from './models3d'

// MapLibre ищет воркер рядом со своим файлом, предсборка Vite этот путь ломает — отдаём собранный воркер явно.
setWorkerUrl(workerUrl)

export const EDU_COLOR = { school: '#5b3cc4', kindergarten: '#e07a2e' }
export const STATUS_COLOR: Record<Status, string> = { ok: '#3a9d6e', warn: '#e3a21a', crit: '#d2452f', unknown: '#9aa1a9', uncertain: '#8c7ae6' }
export const STATUS_LABEL: Record<Status, string> = { ok: 'в норме', warn: 'на пределе', crit: 'перегрузка', unknown: 'нет данных', uncertain: 'не определено' }
export const KIND_LABEL: Record<ObjKind, string> = {
  kindergarten: 'Детский сад', school: 'Школа', shop: 'Магазин', pharmacy: 'Аптека', stop: 'Остановка', parking: 'Стоянка',
  intersection: 'Перекрёсток', clinic: 'Поликлиника', sport: 'Спорт', metro: 'Метро',
}
const PHASE_COLOR = ['#4a72e2', '#7896ee', '#a6bbf5']

export type View = 'base' | 'project' | 'mitigated'
/** Что показывать на карте: 'all' — режим «Эксперт»; иначе — только относящееся к выбранной карточке (null — ничего лишнего). */
export type Focus = 'all' | 'kg' | 'school' | 'roads' | 'parking' | 'shop' | null
export interface Camera { key: number; center: LngLat; zoom: number; pitch: number; bearing: number; duration: number }

interface Props {
  district: District
  project: Project
  objects: ObjectLoad[] // объекты в зонах влияния с загрузкой на выбранный год
  exits: ExitLoad[]
  placed: Placed[] // новые объекты из мероприятий с найденными участками
  coefs: Coefs
  view: View
  yearFloat: number // дробный год — для анимации роста корпусов
  radius: number
  deficit: { kg: boolean; school: boolean }
  selected: string | null
  focus: Focus
  retro?: { cluster: number[]; center: LngLat; radius: number; year: number; labels: { coords: LngLat; text: string }[]; eduAll?: boolean; eduMark?: Record<string, string> } | null // проверка на построенных ЖК; eduAll — все школы и сады района
  onPickBuilding?: (i: number) => void
  moveMode: boolean
  orbit: boolean
  camera: Camera | null // смена key — перелёт камеры (режим показа)
  onPick: (p: LngLat) => void
  onSelect: (id: string | null) => void
}

type FC = GeoJSON.FeatureCollection
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features })
const poly = (ring: LngLat[], properties: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } })
const line = (coords: LngLat[], properties: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } })
const point = (c: LngLat, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: c } })

const STYLE: StyleSpecification = {
  version: 8,
  glyphs: '/fonts/{fontstack}/{range}.pbf', // локальные глифы — карта работает без интернета
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e3e6e9' } }],
  light: { anchor: 'viewport', color: '#ffffff', intensity: 0.42, position: [1.3, 200, 35] },
}

/** Город из выгрузки OSM — строится один раз на район. */
function inside(p: LngLat, ring: LngLat[]) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
type EduRing = { ring: LngLat[]; h: number; year: number } // year — год постройки по OSM, 0 — не указан
/** Здание школы или сада в OSM: контур, внутри которого точка объекта, иначе ближайшее здание образования в 60 м. */
function eduBuildings(d: District) {
  const out = new Map<string, EduRing>()
  const bs = d.buildings ?? []
  for (const o of d.objects) {
    if (o.kind !== 'kindergarten' && o.kind !== 'school') continue
    let best: EduRing | null = null, bd = 90 // точка школы бывает у края участка: школа № 143 — в 60 м от своего здания
    for (const [kind, h, , ring, year = 0] of bs) {
      if (Math.abs(ring[0][1] - o.coords[1]) > 0.002 || Math.abs(ring[0][0] - o.coords[0]) > 0.004) continue
      if (inside(o.coords, ring)) { best = { ring, h, year }; break }
      const dd = distance(o.coords, centroid(ring))
      if (kind === 'edu' && dd < bd) { bd = dd; best = { ring, h, year } }
    }
    if (best) out.set(o.id, best)
  }
  return out
}

function cityData(d: District) {
  return {
    land: fc((d.ground ?? []).map(([kind, ring]) => poly(ring, { kind }))),
    city: fc((d.buildings ?? []).map(([kind, h, , ring, year], i) => poly(ring, { h, kind, year: year ?? 0, i }))),
    roads: fc((d.roads ?? []).map(([cls, name, , coords]) => line(coords, { cls, name }))),
    pois: fc(d.objects.filter(o => ['stop', 'shop', 'pharmacy', 'clinic', 'metro', 'sport', 'parking'].includes(o.kind)).map(o => point(o.coords, { kind: o.kind, name: o.name }))),
  }
}

/** Корпуса ЖК поэтажно: построенные этажи — цвет очереди, будущие — «призрак». */
function projectData(project: Project, yearFloat: number) {
  const built: GeoJSON.Feature[] = []
  const ghost: GeoJSON.Feature[] = []
  for (const b0 of project.buildings) {
    const ph = project.phases[b0.phase]
    if (!ph) continue // очередь удалена — корпус не показываем
    const b = { ...b0, floors: ph.floors ?? b0.floors }
    // стройка идёт в году перед вводом: доля готовых этажей растёт от 0 до 1
    const progress = ph ? Math.max(0, Math.min(1, yearFloat - (ph.year - 1))) : 1
    const done = Math.round(b.floors * progress)
    for (let i = 0; i < b.floors; i++) {
      const f = poly(b.footprint, { base: i * 3, top: i * 3 + 2.6, color: PHASE_COLOR[b.phase % 3] })
      ;(i < done ? built : ghost).push(f)
    }
  }
  return { built: fc(built), ghost: fc(ghost) }
}

/** Новые объекты: в «С ЖК» — контур и полупрозрачный объём «нужно построить», в «С мероприятиями» — модель растёт к году ввода. */
const FAC_NAME = { kindergarten: 'Детский сад', school: 'Школа', parking: 'Паркинг', shop: 'Магазин' }
const SEAT: [string, string, string] = ['место', 'места', 'мест']
const FAC_UNIT: Record<Placed['kind'], [string, string, string]> = { kindergarten: SEAT, school: SEAT, parking: ['машино-место', 'машино-места', 'машино-мест'], shop: ['м²', 'м²', 'м²'] }
function facilitiesData(p: Props) {
  const ground: GeoJSON.Feature[] = [], ext: GeoJSON.Feature[] = [], ghost: GeoJSON.Feature[] = [], outline: GeoJSON.Feature[] = [], labels: GeoJSON.Feature[] = []
  if (p.view !== 'base') for (const f of p.placed.filter(x => x.found)) {
    const progress = Math.max(0, Math.min(1, p.yearFloat - (f.year - 1)))
    const built = p.view === 'mitigated' && progress > 0
    const m = facilityModel({ kind: f.kind, center: f.center, w: f.w, d: f.d, amount: f.amount, progress: built ? progress : 1, id: f.id })
    if (built) { ground.push(...m.ground); ext.push(...m.ext) } else { ghost.push(...m.ext); outline.push(m.ground[0]) }
    labels.push(point(f.center, { label: `${built ? '' : 'Нужно: '}${FAC_NAME[f.kind]}\n${f.amount.toLocaleString('ru-RU')} ${plural(Math.round(f.amount), ...FAC_UNIT[f.kind])} · ${built ? '' : 'к '}${f.year}`, built: built ? 1 : 0 }))
  }
  return { facGround: fc(ground), facExt: fc(ext), facGhost: fc(ghost), facLine: fc(outline), facLabels: fc(labels) }
}

function analysisData(p: Props, edu: Map<string, EduRing>) {
  const center = centroid(p.project.site)
  const byId = new Map(p.district.objects.map(o => [o.id, o]))
  const objExt: GeoJSON.Feature[] = []
  const objGround: GeoJSON.Feature[] = []
  const nodes: GeoJSON.Feature[] = []
  const labels: GeoJSON.Feature[] = []
  for (const o of p.objects) {
    const src = byId.get(o.id)
    if (!src) continue
    const r = p.view === 'base' ? o.before : o.after
    const status = p.view === 'base' ? o.statusBefore : o.status
    const color = p.selected === o.id ? '#1f4fd8' : STATUS_COLOR[status]
    if (o.kind === 'kindergarten' || o.kind === 'school') {
      // само здание окрашено статусом; нет здания в данных (синтетика) — модель с кровлей цвета статуса
      const b = edu.get(o.id)
      if (b) objExt.push(poly(b.ring, { base: 0, top: b.h + 0.4, color, id: o.id }))
      else {
        const cap = src.capacity ?? (o.kind === 'school' ? 800 : 150)
        const a = o.kind === 'school' ? 1.55 : 1.35
        const w = Math.sqrt(cap * (o.kind === 'school' ? 24 : 38) * a)
        const m = facilityModel({ kind: o.kind, center: src.coords, w, d: w / a, amount: cap, progress: 1, roof: color, id: o.id })
        objGround.push(...m.ground); objExt.push(...m.ext)
      }
    }
    // простой вид: подпись и точка — только у проблемных, выбранного и того, что относится к открытой карточке
    const all = p.focus === 'all', sel = p.selected === o.id, bad = status === 'crit' || status === 'warn'
    const related = (p.focus === 'roads' && (o.kind === 'intersection' || o.kind === 'stop')) || (p.focus === 'kg' && o.kind === 'kindergarten') || (p.focus === 'school' && o.kind === 'school')
    if (o.kind !== 'kindergarten' && o.kind !== 'school' && (all || sel || bad || related)) nodes.push(point(src.coords, { color, id: o.id, kind: o.kind }))
    const pct = r === null ? 'нет данных' : o.range && p.view !== 'base' ? `${Math.round(o.range[0] * 100)}–${Math.round(o.range[1] * 100)}%` : `${Math.round(r * 100)}%`
    if (all ? o.kind !== 'stop' || sel : sel || bad || related) labels.push(point(src.coords, { label: `${short(o.name)}\n${pct}`, color, id: o.id }))
  }
  const zone = (r: number, bad: boolean, kind: string) => poly(circle(center, r, 96), { kind, bad: bad ? 1 : 0 })
  // простой вид: круг доступности садов и школ виден всегда (красный — в выбранном году не хватает мест) с подписью радиуса на северной кромке
  const eduBad = p.focus === 'kg' ? p.deficit.kg : p.focus === 'school' ? p.deficit.school : p.deficit.kg || p.deficit.school
  const zones = fc(p.focus === 'all' ? [
    zone(p.radius, p.deficit.kg || p.deficit.school, 'edu'),
    zone(p.coefs.stopRadius.value, false, 'stop'),
    zone(p.coefs.roadRadius.value, false, 'road'),
  ] : p.focus === 'roads' ? [zone(p.coefs.stopRadius.value, false, 'stop')]
    : [zone(p.radius, eduBad, 'edu'), point(circle(center, p.radius, 4)[0], { label: `${p.radius} м`, bad: eduBad ? 1 : 0 })])
  const traffic = p.view !== 'base' && (p.focus === 'all' || p.focus === 'roads')
  // потоки: выезд → ближайший узел (анимированный пунктир)
  const hitNodes = p.objects.filter(o => o.kind === 'intersection' && o.added > 0)
  const flows = fc(!traffic ? [] : p.exits.flatMap(e => {
    const n = hitNodes.map(o => byId.get(o.id)!).sort((a, b) => distance(e.coords, a.coords) - distance(e.coords, b.coords))[0]
    return n ? [line([e.coords, n.coords], { w: Math.max(1.5, Math.min(7, e.flow / 90)) })] : []
  }))
  const exits = fc(!traffic ? [] : p.exits.map(e => point(e.coords, { z: e.z, color: e.z >= 1 ? STATUS_COLOR.crit : e.z >= 0.7 ? STATUS_COLOR.warn : '#1f4fd8' })))
  return { site: fc([poly(p.project.site)]), zones, objExt: fc(objExt), objGround: fc(objGround), nodes: fc(nodes), labels: fc(labels), flows, exits }
}

/** Режим проверки: выбранный построенный ЖК, зона и школы/сады с фактом; проект и мероприятия скрыты. */
function retroData(p: Props, r: NonNullable<Props['retro']>, edu: Map<string, EduRing>) {
  const e = fc([])
  const bs = p.district.buildings ?? []
  // школы и сады, построенные позже выбранного года, скрыты вместе с подписью — как и остальные дома
  const eo = r.eduAll ? p.district.objects.filter(o => (o.kind === 'school' || o.kind === 'kindergarten') && !((edu.get(o.id)?.year ?? 0) > Math.floor(r.year + 1e-6))) : []
  // сады без данных о детях (частные) — без подписи
  // eduMark — школы конкретных домов: они фиолетовые с пометкой, остальные школы серые без подписи
  const other = (o: (typeof eo)[number]) => !!r.eduMark && o.kind === 'school' && !(o.id in r.eduMark)
  const col = (o: (typeof eo)[number]) => (other(o) ? '#c3c7cd' : EDU_COLOR[o.kind as 'school' | 'kindergarten'])
  return {
    built: e, ghost: e, site: e, objGround: e,
    objExt: fc(eo.flatMap(o => { const b = edu.get(o.id); return b ? [poly(b.ring, { base: 0, top: b.h + 0.4, color: col(o), id: o.id })] : [] })), nodes: e, flows: e, exits: e, facGround: e, facExt: e, facGhost: e, facLine: e, facLabels: e,
    zones: fc(r.radius ? [poly(circle(r.center, r.radius, 96), { kind: 'edu', bad: 0 })] : []), // radius 0 — весь район, без зоны
    labels: fc([...r.labels.map(l => point(l.coords, { label: l.text, color: '#1e2328' })),
      ...eo.filter(o => !other(o) && (o.kind === 'school' || o.load)).map(o => point(o.coords, { label: `${short(o.name)}
${r.eduMark?.[o.id] ?? (o.load ? `${o.load.toLocaleString('ru-RU')} ${o.kind === 'school' ? 'уч.' : 'дет.'} · 2026` : 'нет данных')}`, color: col(o), id: o.id }))]),
    // стройка в год перед вводом: высота растёт от 0 до полной
    retroSel: fc(r.cluster.map(i => ({ i, k: Math.max(0, Math.min(1, r.year - ((bs[i][4] || 0) - 1))) })).filter(x => x.k > 0).map(x => poly(bs[x.i][3], { h: (bs[x.i][1] + 0.6) * x.k, far: r.radius && distance(centroid(bs[x.i][3]), r.center) > r.radius ? 1 : 0 }))), // far — дальше радиуса доступности
  }
}

const short = (s: string) => s.replace(/улица\s*/gu, '').replace(/проспект/gu, 'пр.').replace(/^(МБОУ|МАОУ|МБДОУ|МАДОУ|МБДОУ«|ГБОУ|АНО|ЧДОУ)\s*/u, '').replace(/[«»"]/g, '').replace(/\s*(комбинированного вида|Советского района.*|Приволжского района.*)$/u, '').slice(0, 34)

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const ready = useRef(false)
  const [loaded, setLoaded] = useState(false) // эффекты фильтров и цветов, сработавшие до загрузки стиля, повторяются после неё
  const cb = useRef(props)
  cb.current = props

  const city = useMemo(() => cityData(props.district), [props.district])
  const edu = useMemo(() => eduBuildings(props.district), [props.district])
  const proj = projectData(props.project, props.view === 'base' ? -Infinity : props.yearFloat)
  const analysis = analysisData(props, edu)
  const dynamic = props.retro ? retroData(props, props.retro, edu) : { ...proj, ...analysis, ...facilitiesData(props), retroSel: fc([]) }
  const latest = useRef(dynamic)
  latest.current = dynamic
  const cityRef = useRef(city)
  cityRef.current = city

  useEffect(() => {
    const m = new MLMap({ container: el.current!, style: STYLE, center: centroid(props.project.site), zoom: 15.3, pitch: 58, bearing: -28, maxPitch: 75, attributionControl: false })
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { map: MLMap }).map = m
    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    m.on('load', () => {
      for (const [id, v] of Object.entries({ ...cityRef.current, ...latest.current })) m.addSource(id, { type: 'geojson', data: v })
      const cls = ['match', ['get', 'cls'], ['motorway', 'trunk', 'primary'], 3.2, 'secondary', 2.4, 'tertiary', 1.8, 1]
      const roadW = (k: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['*', cls, 0.4 * k], 17, ['*', cls, 6 * k]] as unknown as number
      m.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': ['match', ['get', 'kind'], 'park', '#d5e6cf', 'water', '#c9def0', '#eceeef'] } })
      m.addLayer({ id: 'roads-case', type: 'line', source: 'roads', paint: { 'line-color': '#cfd4d9', 'line-width': roadW(1.35) }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#f7f8f9', 'line-width': roadW(1) }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', filter: ['==', ['get', 'kind'], 'edu'], paint: { 'fill-color': ['case', ['==', ['get', 'bad'], 1], '#d2452f', '#3a9d6e'], 'fill-opacity': 0.07 } })
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: {
        'line-color': ['match', ['get', 'kind'], 'edu', ['case', ['==', ['get', 'bad'], 1], '#d2452f', '#3a9d6e'], 'stop', '#1f4fd8', '#8b95a1'],
        'line-width': ['match', ['get', 'kind'], 'edu', 2, 1.2], 'line-dasharray': [3, 2], 'line-opacity': ['match', ['get', 'kind'], 'road', 0.5, 0.9] } })
      m.addLayer({ id: 'site-fill', type: 'fill', source: 'site', paint: { 'fill-color': '#1f4fd8', 'fill-opacity': 0.1 } })
      m.addLayer({ id: 'site-line', type: 'line', source: 'site', paint: { 'line-color': '#1f4fd8', 'line-width': 2, 'line-dasharray': [2, 1.2] } })
      m.addLayer({ id: 'flows', type: 'line', source: 'flows', paint: { 'line-color': '#1f4fd8', 'line-width': ['get', 'w'], 'line-dasharray': [0, 2, 2], 'line-opacity': 0.9 }, layout: { 'line-cap': 'round' } })
      m.addLayer({ id: 'fac-ground', type: 'fill', source: 'facGround', paint: { 'fill-color': ['get', 'color'] } })
      m.addLayer({ id: 'obj-ground', type: 'fill', source: 'objGround', paint: { 'fill-color': ['get', 'color'] } })
      m.addLayer({ id: 'fac-line', type: 'line', source: 'facLine', paint: { 'line-color': '#d2452f', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      m.addLayer({ id: 'city', type: 'fill-extrusion', source: 'city', paint: {
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-color': ['match', ['get', 'kind'], 'res', '#fbfaf6', 'house', '#efece5', 'edu', '#f5efe0', 'com', '#eceef1', '#e9eaec'],
        'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true } })
      m.addLayer({ id: 'retro-sel', type: 'fill-extrusion', source: 'retroSel', paint: { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-color': ['case', ['==', ['get', 'far'], 1], '#9cbcf7', '#1f4fd8'], 'fill-extrusion-opacity': 0.95 } })
      m.on('click', 'city', (e: MapLayerMouseEvent) => { const i = e.features?.[0]?.properties?.i; if (cb.current.retro && cb.current.onPickBuilding && i !== undefined) cb.current.onPickBuilding(Number(i)) })
      const ext = (opacity: number) => ({ 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-opacity': opacity }) as never
      m.addLayer({ id: 'obj-ext', type: 'fill-extrusion', source: 'objExt', paint: ext(0.97) })
      m.addLayer({ id: 'fac-ext', type: 'fill-extrusion', source: 'facExt', paint: ext(0.98) })
      m.addLayer({ id: 'fac-ghost', type: 'fill-extrusion', source: 'facGhost', paint: { 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-color': '#e8806d', 'fill-extrusion-opacity': 0.3 } })
      m.addLayer({ id: 'ghost', type: 'fill-extrusion', source: 'ghost', paint: { 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-color': '#9fb6f5', 'fill-extrusion-opacity': 0.22 } })
      m.addLayer({ id: 'built', type: 'fill-extrusion', source: 'built', paint: { 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-opacity': 0.97 } })
      m.addLayer({ id: 'pois', type: 'circle', source: 'pois', minzoom: 14.5, paint: {
        'circle-radius': ['match', ['get', 'kind'], 'metro', 7, 3.2],
        'circle-color': ['match', ['get', 'kind'], 'stop', '#1f4fd8', 'pharmacy', '#3a9d6e', 'clinic', '#d2452f', 'metro', '#c2185b', 'parking', '#7b8794', '#a38b5e'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } })
      m.addLayer({ id: 'metro-label', type: 'symbol', source: 'pois', filter: ['==', ['get', 'kind'], 'metro'], layout: {
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': '#c2185b', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })
      m.addLayer({ id: 'nodes', type: 'circle', source: 'nodes', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, ['match', ['get', 'kind'], 'intersection', 4, 2.5], 17, ['match', ['get', 'kind'], 'intersection', 16, 8]],
        'circle-color': ['get', 'color'], 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } })
      m.addLayer({ id: 'exits', type: 'circle', source: 'exits', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'labels', type: 'symbol', source: 'labels', layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, -0.4], 'text-anchor': 'bottom',
        'text-allow-overlap': false, 'text-padding': 2, 'symbol-sort-key': ['case', ['==', ['get', 'color'], '#d2452f'], 0, 1] },
        paint: { 'text-color': '#1e2328', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.8 } })
      m.addLayer({ id: 'fac-labels', type: 'symbol', source: 'facLabels', layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-anchor': 'center', 'text-allow-overlap': true },
        paint: { 'text-color': ['case', ['==', ['get', 'built'], 1], '#1f6f4a', '#b33a26'], 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 2 } })
      m.addLayer({ id: 'zones-label', type: 'symbol', source: 'zones', filter: ['==', ['geometry-type'], 'Point'], layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': ['case', ['==', ['get', 'bad'], 1], '#b33a26', '#23704b'], 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 2 } })
      ready.current = true
      setLoaded(true)
      for (const id of ['obj-ext', 'nodes', 'labels']) {
        m.on('click', id, (e: MapLayerMouseEvent) => { if (!cb.current.moveMode) cb.current.onSelect(String(e.features?.[0]?.properties?.id ?? '')) })
        m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', id, () => (m.getCanvas().style.cursor = cb.current.moveMode ? 'crosshair' : ''))
      }
      // анимация потоков машин: бегущий пунктир
      const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
      let step = 0
      const tick = (t: number) => {
        const s = Math.floor(t / 70) % seq.length
        if (s !== step && m.getLayer('flows')) { m.setPaintProperty('flows', 'line-dasharray', seq[s]); step = s }
        if (cb.current.orbit) m.setBearing(m.getBearing() + 0.06)
        raf = requestAnimationFrame(tick)
      }
      let raf = requestAnimationFrame(tick)
      m.once('remove', () => cancelAnimationFrame(raf))
    })
    m.on('click', (e: MapMouseEvent) => {
      if (cb.current.moveMode) cb.current.onPick([e.lngLat.lng, e.lngLat.lat])
      else if (!m.queryRenderedFeatures(e.point, { layers: ['obj-ext', 'nodes', 'labels'].filter(l => m.getLayer(l)) }).length) cb.current.onSelect(null)
    })
    // контейнер меняет размер (сворачивание панели, сетка) — без resize() холст растягивается и сцена «уезжает»
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); m.remove() }
    // карта создаётся один раз, данные обновляются эффектом ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    for (const [id, v] of Object.entries(latest.current)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(v)
  })

  // город меняется только при смене района — не пересылаем 17 тыс. зданий на каждый кадр
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    for (const [id, v] of Object.entries(city)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(v)
  }, [city])

  const retroOn = !!props.retro
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current || !m.getLayer('city')) return
    m.getCanvas().style.cursor = ''
  }, [retroOn, loaded])
  // проверка: дома, построенные позже выбранного года, скрыты — шкала показывает, как застраивалась зона
  // выделенные дома рисует слой retro-sel — в городе их скрываем, иначе грани двух слоёв мерцают
  const retroYear = props.retro ? Math.floor(props.retro.year + 1e-6) : null
  const sel = props.retro?.cluster.join(',') ?? ''
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current || !m.getLayer('city')) return
    if (retroYear === null) { m.setFilter('city', null); return }
    const byYear = ['any', ['==', ['get', 'year'], 0], ['<=', ['get', 'year'], retroYear]]
    m.setFilter('city', (sel ? ['all', byYear, ['!', ['in', ['get', 'i'], ['literal', sel.split(',').map(Number)]]]] : byYear) as never)
  }, [retroYear, sel, loaded])

  // точки города (остановки, магазины, аптеки, стоянки): в простом виде — только метро и то, что относится к открытой карточке
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current || !m.getLayer('pois')) return
    const f = props.focus
    const kinds = f === 'all' ? null : ['metro', ...(f === 'roads' ? ['stop'] : f === 'shop' ? ['shop', 'pharmacy'] : f === 'parking' ? ['parking'] : [])]
    m.setFilter('pois', kinds ? ['in', ['get', 'kind'], ['literal', kinds]] : null)
  })

  useEffect(() => {
    map.current?.getCanvas().style.setProperty('cursor', props.moveMode ? 'crosshair' : '')
  }, [props.moveMode])

  useEffect(() => {
    const c = props.camera
    if (c) map.current?.flyTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing, duration: c.duration, essential: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.camera?.key])

  const siteKey = props.project.site[0].join()
  useEffect(() => {
    if (props.retro) return // участка ЖК на карте нет (Ново-Савиновский) — камерой управляет раздел, иначе перебьём её облёт
    map.current?.easeTo({ center: centroid(props.project.site), duration: 900 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  return <div ref={el} className="map" />
}
