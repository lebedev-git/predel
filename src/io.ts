import { centroid, distance, type LngLat } from './model/geo'
import type { District, DistrictObject, ObjKind, Project, Result } from './model/model'

// Импорт данных района и проекта, проверка, экспорт. ТЗ: «корректность загрузки параметров», «воспроизводимость расчёта».

const KINDS = new Set<ObjKind>(['kindergarten', 'school', 'shop', 'pharmacy', 'stop', 'parking', 'intersection', 'clinic', 'sport', 'metro'])

export interface Check { ok: number; issues: string[]; byKind: Record<string, { n: number; noCap: number; noLoad: number }> }

const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(String(v).replace(',', '.')))
const KIND_RU: Record<string, ObjKind> = {
  'школа': 'school', 'гимназия': 'school', 'лицей': 'school', 'детский сад': 'kindergarten', 'сад': 'kindergarten', 'доо': 'kindergarten',
  'магазин': 'shop', 'аптека': 'pharmacy', 'остановка': 'stop', 'стоянка': 'parking', 'парковка': 'parking', 'перекрёсток': 'intersection',
  'перекресток': 'intersection', 'поликлиника': 'clinic', 'спорт': 'sport', 'метро': 'metro',
}
const COL_RU: Record<string, string> = { 'вид': 'kind', 'тип': 'kind', 'название': 'name', 'наименование': 'name', 'мощность': 'capacity', 'вместимость': 'capacity',
  'загрузка': 'load', 'контингент': 'load', 'год открытия': 'openyear', 'долгота': 'lon', 'широта': 'lat' }

function normalize(raw0: Partial<DistrictObject> & Record<string, unknown>, i: number, issues: string[]): DistrictObject | null {
  // русские ключи («вид», «мощность», …) — и в JSON/GeoJSON, не только в CSV
  const raw = Object.fromEntries(Object.entries(raw0).map(([k, v]) => [COL_RU[k.trim().toLowerCase()] ?? k, v])) as typeof raw0
  const k0 = String(raw.kind ?? '').trim().toLowerCase()
  const kind = (KIND_RU[k0] ?? k0) as ObjKind
  if (!KINDS.has(kind)) { issues.push(`строка ${i + 1}: неизвестный вид «${raw.kind}»`); return null }
  const coords = (Array.isArray(raw.coords) ? raw.coords : [num(raw.lon ?? raw.lng), num(raw.lat)]) as LngLat
  if (!Array.isArray(coords) || coords.length < 2 || !coords.every(Number.isFinite) || Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) {
    issues.push(`строка ${i + 1}: некорректные координаты`); return null
  }
  const o: DistrictObject = { id: String(raw.id ?? `${kind}-${i}`), kind, name: String(raw.name ?? `${kind} ${i + 1}`), coords: [Number(coords[0]), Number(coords[1])] }
  for (const k of ['capacity', 'load', 'openYear'] as const) {
    const v = num(raw[k] ?? raw[k.toLowerCase()])
    if (v === undefined) continue
    if (!Number.isFinite(v) || v < 0) { issues.push(`«${o.name}»: ${k} = ${raw[k]} — не число или отрицательное, пропущено`); continue }
    o[k] = v
  }
  const rg = raw.capacityRange as unknown
  if (Array.isArray(rg) && rg.length === 2 && rg.every(x => Number.isFinite(Number(x)) && Number(x) >= 0)) o.capacityRange = [Number(rg[0]), Number(rg[1])]
  // статусы и источники из файла сохраняются; без них — «загружено пользователем»
  const info = raw.info as DistrictObject['info'] | undefined
  if (info && typeof info === 'object') o.info = info
  else if (o.capacity !== undefined || o.load !== undefined) o.info = { capacity: { status: o.capacityRange ? 'оценка' : 'факт', text: 'загружено пользователем' }, load: { status: 'факт', text: 'загружено пользователем' } }
  return o
}

function check(objects: DistrictObject[], issues: string[]): Check {
  const ids = new Set<string>()
  const byKind: Check['byKind'] = {}
  for (const o of objects) {
    if (ids.has(o.id)) issues.push(`повторяющийся id «${o.id}»`)
    ids.add(o.id)
    const k = (byKind[o.kind] ??= { n: 0, noCap: 0, noLoad: 0 })
    k.n++
    if (o.capacity === undefined) k.noCap++
    if (o.load === undefined) k.noLoad++
  }
  return { ok: objects.length, issues, byKind }
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const sep = lines[0].includes(';') ? ';' : ','
  const head = lines[0].split(sep).map(h => { const x = h.trim().toLowerCase(); return COL_RU[x] ?? x })
  return lines.slice(1).map(l => {
    const cells = l.split(sep)
    const row = Object.fromEntries(head.map((h, i) => [h, cells[i]?.trim()]))
    return { ...row, coords: [num(row.lon ?? row.lng ?? row['долгота']), num(row.lat ?? row['широта'])] as LngLat }
  })
}

export interface SavedScenario { coefs?: Record<string, number>; pace?: number[]; wave?: boolean; cohorts?: boolean; constrained?: boolean }
export type Imported = { type: 'district'; district: District; check: Check } | { type: 'project'; project: Project; scenario?: SavedScenario }

/** Проверка проекта: обязательные поля, конечные неотрицательные числа, геометрия; недостающее — нулями. */
function normalizeProject(j: Record<string, unknown>): Project {
  const phases = (j.phases as Record<string, unknown>[]).map((ph, i) => {
    const year = Number(ph.year), apartments = Number(ph.apartments), area = Number(ph.area ?? Number(ph.apartments) * 77.5)
    if (![year, apartments, area].every(Number.isFinite) || apartments < 0 || area < 0 || year < 2000 || year > 2100) throw new Error(`очередь ${i + 1}: год, квартиры и площадь должны быть числами ≥ 0`)
    return { name: String(ph.name ?? `Очередь ${i + 1}`), year: Math.round(year), apartments, area, floors: ph.floors === undefined ? undefined : Number(ph.floors) }
  })
  const site = j.site as LngLat[]
  if (!Array.isArray(site) || site.length < 4 || !site.every(p => Array.isArray(p) && p.every(Number.isFinite))) throw new Error('site — замкнутый контур [[долгота, широта], …] из 4+ точек')
  const nz = (v: unknown) => { const x = Number(v ?? 0); if (!Number.isFinite(x) || x < 0) throw new Error(`недопустимое значение ${v}`); return x }
  return {
    name: String(j.name ?? 'Загруженный проект'), site, phases,
    buildings: Array.isArray(j.buildings) ? (j.buildings as Project['buildings']) : [],
    residentsOverride: j.residentsOverride === undefined ? undefined : nz(j.residentsOverride) || undefined,
    exits: Array.isArray(j.exits) ? (j.exits as Project['exits']) : [], exitCount: j.exitCount === undefined ? undefined : nz(j.exitCount),
    rooms: j.rooms as Project['rooms'],
    kindergartenSeats: nz(j.kindergartenSeats), kindergartenYear: j.kindergartenYear as number | undefined,
    schoolSeats: nz(j.schoolSeats), schoolYear: j.schoolYear as number | undefined,
    retailArea: nz(j.retailArea), retailYear: j.retailYear as number | undefined, parkingPlanned: nz(j.parkingPlanned),
    stoves: j.stoves === 'gas' ? 'gas' : 'electric',
    networkReserve: j.networkReserve as Project['networkReserve'],
  }
}

export function importFile(text: string, fileName: string): Imported {
  const issues: string[] = []
  const date = new Date().toISOString().slice(0, 10)
  if (/\.csv$/i.test(fileName)) {
    const objects = parseCsv(text).map((r, i) => normalize(r as never, i, issues)).filter(Boolean) as DistrictObject[]
    if (!objects.length) throw new Error('в CSV нет строк с колонками kind, name, lon, lat (capacity, load — по желанию)')
    return { type: 'district', district: { name: fileName, synthetic: false, dataDate: date, objects }, check: check(objects, issues) }
  }
  const j = JSON.parse(text)
  if (Array.isArray(j.phases) && Array.isArray(j.site)) return { type: 'project', project: normalizeProject(j) }
  if (Array.isArray(j.project?.phases)) return { type: 'project', project: normalizeProject(j.project), scenario: j.scenario } // сохранённый сценарий
  if (Array.isArray(j.objects)) {
    const objects = (j.objects as Record<string, unknown>[]).map((r, i) => normalize(r, i, issues)).filter(Boolean) as DistrictObject[]
    return { type: 'district', district: { ...j, objects, synthetic: !!j.synthetic, dataDate: j.dataDate ?? date, name: j.name ?? fileName }, check: check(objects, issues) }
  }
  if (j.type === 'FeatureCollection') {
    const objects = (j.features as GeoJSON.Feature[])
      .filter(f => ['Point', 'Polygon', 'MultiPolygon'].includes(f.geometry?.type))
      .map((f, i) => {
        const g = f.geometry as GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon
        // участок школы/сада полигоном — точка объекта в его центре
        const coords = (g.type === 'Point' ? g.coordinates : centroid((g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]) as LngLat[])) as LngLat
        return normalize({ ...f.properties, coords }, i, issues)
      })
      .filter(Boolean) as DistrictObject[]
    if (!objects.length) throw new Error('в GeoJSON нет точек или полигонов со свойством kind: kindergarten | school | shop | pharmacy | stop | parking | intersection | clinic')
    return { type: 'district', district: { name: fileName, synthetic: false, dataDate: date, objects }, check: check(objects, issues) }
  }
  throw new Error('ожидается JSON района ({ objects: [...] }), JSON проекта ({ phases, site }), GeoJSON или CSV')
}

/** Таблица объектов (мощности, контингент ЦГТ) поверх района с 3D-застройкой: совпавший объект (тот же id или тот же вид
 *  в 150 м) получает значения из файла как факт — оценочный диапазон снимается; несовпавшие добавляются. Здания и дороги остаются. */
export function mergeObjects(base: District, upd: DistrictObject[], file: string): { district: District; matched: number; added: number } {
  const objects: DistrictObject[] = base.objects.map(o => ({ ...o }))
  const src = (st: 'факт' | 'оценка') => ({ status: st, text: `загружено из файла «${file}»` })
  const used = new Set<DistrictObject>()
  let matched = 0, added = 0
  for (const u of upd) {
    // совпадение по id — только тот же вид рядом (автоматические id разных файлов совпадают); один объект — одна строка
    let t = objects.find(o => o.id === u.id && o.kind === u.kind && distance(o.coords, u.coords) < 150 && !used.has(o))
    let best = 150
    if (!t) for (const o of objects) { if (o.kind !== u.kind || used.has(o)) continue; const d = distance(o.coords, u.coords); if (d < best) { best = d; t = o } }
    if (!t) { objects.push(u); used.add(u); added++; continue }
    used.add(t)
    matched++
    if (u.capacity !== undefined) { t.capacity = u.capacity; t.capacityRange = u.capacityRange; t.info = { ...t.info, capacity: src(u.capacityRange ? 'оценка' : 'факт') } }
    if (u.load !== undefined) { t.load = u.load; t.info = { ...t.info, load: src('факт') } }
    if (u.openYear !== undefined) t.openYear = u.openYear
  }
  const date = new Date().toISOString().slice(0, 10)
  const title = `Файл «${file}»`
  return { district: { ...base, objects, name: base.name.endsWith(` + ${file}`) ? base.name : `${base.name} + ${file}`,
    sources: [...(base.sources ?? []).filter(x => x.title !== title), { title, url: '', note: `загружен ${date}` }] }, matched, added }
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

/** Результат в GeoJSON — для загрузки в цифровой двойник / ГИС: объекты с загрузкой до и после, год, статус. */
export function resultGeoJSON(district: District, project: Project, result: Result, yearIdx: number): GeoJSON.FeatureCollection {
  const h = result.years[yearIdx]
  const byId = new Map(district.objects.map(o => [o.id, o]))
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'project', name: project.name, year: h.year, population: h.population }, geometry: { type: 'Polygon', coordinates: [project.site] } },
      ...h.objects.map(o => ({ type: 'Feature' as const, properties: { ...o, year: h.year }, geometry: { type: 'Point' as const, coordinates: byId.get(o.id)!.coords } })),
    ],
  }
}
