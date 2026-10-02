import type { LngLat } from '../model/geo'
import type { Building, District, Project } from '../model/model'

// Тестовые проекты ЖК (ТЗ: «2–3 тестовых проекта жилого комплекса с различными параметрами») и контрольный
// синтетический район, где известны все мощности и загрузки. Координаты — смещение в метрах от центра участка.

/** Участок по умолчанию: пустырь в Азино (Советский район) западнее ул. Юлиуса Фучика — не задевает улицу; строящаяся станция метро в 330 м. */
export const KAZAN_SITE: LngLat = [49.228, 55.76]
/** Ново-Савиновский район застроен плотно: свободного участка под ЖК-1 (330 × 230 м) рядом со школами нет — только под ЖК-2
 *  (230 × 170 м): у бывшей промзоны (OSM landuse=brownfield) на ул. Сибгата Хакима, в 550 м — 5 школ и садов; без зданий, улиц, воды и парков. */
export const NSAV_SITE: LngLat = [49.1426, 55.813]
export const SYNTHETIC_SITE: LngLat = [49.2594, 55.745]

const at = (dx: number, dy: number, c: LngLat): LngLat => [c[0] + dx / 62600, c[1] + dy / 111200]
const rect = (cx: number, cy: number, w: number, h: number, c: LngLat): LngLat[] =>
  [at(cx - w / 2, cy - h / 2, c), at(cx + w / 2, cy - h / 2, c), at(cx + w / 2, cy + h / 2, c), at(cx - w / 2, cy + h / 2, c), at(cx - w / 2, cy - h / 2, c)]

export type ProjectKind = 'big' | 'small'
export const PROJECT_LABEL: Record<ProjectKind, string> = { big: 'ЖК-1 · 1 800 кв., две очереди', small: 'ЖК-2 · 900 кв., встроенный сад' }

export function buildProject(kind: ProjectKind, c: LngLat): Project {
  if (kind === 'big') {
    // 1 800 кв., 139 500 м² квартир (77,5 м²/кв. — как в примере ТЗ при 30 м²/чел.)
    const b = (cx: number, cy: number, floors: number, phase: number): Building => ({ footprint: rect(cx, cy, 78, 17, c), floors, phase })
    return {
      name: 'ЖК-1 (контрольный проект ТЗ)',
      site: rect(0, 0, 330, 230, c),
      buildings: [b(-100, 70, 25, 0), b(0, 70, 21, 0), b(100, 70, 17, 0), b(-100, -45, 17, 1), b(0, -45, 21, 1), b(100, -45, 25, 1)],
      phases: [{ name: 'Очередь 1', year: 2027, apartments: 1000, area: 77_500 }, { name: 'Очередь 2', year: 2029, apartments: 800, area: 62_000 }],
      residentsOverride: 4650,
      exits: [],
      rooms: { studio: 0.15, one: 0.35, two: 0.35, three: 0.15 },
      kindergartenSeats: 0,
      schoolSeats: 0,
      retailArea: 600,
      parkingPlanned: 900,
      stoves: 'electric',
    }
  }
  const b = (cx: number, cy: number, floors: number): Building => ({ footprint: rect(cx, cy, 30, 30, c), floors, phase: 0 })
  return {
    name: 'ЖК-2 (башни со встроенным садом)',
    site: rect(0, 0, 230, 170, c),
    buildings: [b(-70, 35, 24), b(0, 35, 27), b(70, 35, 24), b(-35, -45, 20), b(35, -45, 20)],
    phases: [{ name: 'Очередь 1', year: 2028, apartments: 900, area: 63_000 }],
    exits: [],
    rooms: { studio: 0.25, one: 0.4, two: 0.25, three: 0.1 },
    kindergartenSeats: 120,
    kindergartenYear: 2028,
    schoolSeats: 0,
    retailArea: 400,
    parkingPlanned: 700,
    stoves: 'electric',
  }
}

/** Контрольный район: все мощности и загрузки известны (синтетика) — проверка формул и стресс-тест. */
const s = (dx: number, dy: number) => at(dx, dy, SYNTHETIC_SITE)
export const SYNTHETIC_DISTRICT: District = {
  name: 'Контрольный район (синтетические данные)',
  synthetic: true,
  dataDate: '2026-09-30',
  sources: [{ title: 'Синтетические данные для проверки метода', url: '', note: 'все мощности и загрузки заданы вручную' }],
  objects: [
    { id: 'kg1', kind: 'kindergarten', name: 'Детский сад № 1', coords: s(180, 120), capacity: 250, load: 100 },
    { id: 'kg2', kind: 'kindergarten', name: 'Детский сад № 2', coords: s(-240, 90), capacity: 200, load: 110 },
    { id: 'kg3', kind: 'kindergarten', name: 'Детский сад № 3', coords: s(900, -250), capacity: 600, load: 100 },
    { id: 'sc1', kind: 'school', name: 'Школа № 1', coords: s(-300, 250), capacity: 1100, load: 720 },
    { id: 'sc2', kind: 'school', name: 'Школа № 2 (строится)', coords: s(420, -380), capacity: 1224, load: 0, openYear: 2031 },
    { id: 'sh1', kind: 'shop', name: 'Супермаркет', coords: s(260, -40), capacity: 900, load: 800 },
    { id: 'sh2', kind: 'shop', name: 'Магазин у дома', coords: s(-160, 200), capacity: 400, load: 380 },
    { id: 'ph1', kind: 'pharmacy', name: 'Аптека', coords: s(-120, 230) },
    { id: 'st1', kind: 'stop', name: 'Остановка «Северная»', coords: s(150, 150), capacity: 1600, load: 1200 },
    { id: 'st2', kind: 'stop', name: 'Остановка «Парковая»', coords: s(-200, -150), capacity: 1200, load: 900 },
    { id: 'pk1', kind: 'parking', name: 'Открытая стоянка', coords: s(250, 60), capacity: 300, load: 260 },
    { id: 'cl1', kind: 'clinic', name: 'Поликлиника', coords: s(-600, 400) },
    { id: 'x1', kind: 'intersection', name: 'Перекрёсток А', coords: s(300, 0), capacity: 1200, load: 900 },
    { id: 'x2', kind: 'intersection', name: 'Перекрёсток Б', coords: s(-300, 0), capacity: 1200, load: 900 },
    { id: 'x3', kind: 'intersection', name: 'Перекрёсток В', coords: s(0, 420), capacity: 1600, load: 900 },
    { id: 'x4', kind: 'intersection', name: 'Перекрёсток на магистрали', coords: s(600, 500), capacity: 2000, load: 1100 },
  ],
}

/** Пример из ТЗ (раздел «Задача участников»), по нему откалиброваны доли детей и поездки: ЖК 1 800 кв. → 4 650 жит.; ожидаемые 410 / 620 мест,
 *  дефицит 170 / 240 в зоне доступности, +780 авто и +1 050 поездок на ОТ в утренний пик, два перекрёстка в критической зоне. */
const k = (dx: number, dy: number): LngLat => at(dx, dy, [49.15, 55.79])
export const CONTROL_DISTRICT: District = {
  name: 'Контрольный район ТЗ', synthetic: true, dataDate: '2026-09-30',
  objects: [
    { id: 'kg1', kind: 'kindergarten', name: 'ДОО 1', coords: k(200, 0), capacity: 250, load: 100 },
    { id: 'kg2', kind: 'kindergarten', name: 'ДОО 2', coords: k(0, 250), capacity: 200, load: 110 },
    { id: 'kg3', kind: 'kindergarten', name: 'ДОО далеко', coords: k(900, 0), capacity: 600, load: 100 },
    { id: 's1', kind: 'school', name: 'Школа 1', coords: k(-300, 200), capacity: 1100, load: 720 },
    { id: 'x1', kind: 'intersection', name: 'Перекрёсток А', coords: k(300, 0), capacity: 1200, load: 900 },
    { id: 'x2', kind: 'intersection', name: 'Перекрёсток Б', coords: k(-300, 0), capacity: 1200, load: 900 },
    { id: 'st1', kind: 'stop', name: 'Остановка 1', coords: k(150, 150), capacity: 1600, load: 1200 },
  ],
}
export const controlProject = (apartments = 1800): Project => ({
  name: 'Контрольный ЖК ТЗ', site: [k(-50, -50), k(50, -50), k(50, 50), k(-50, 50), k(-50, -50)], buildings: [],
  phases: [{ name: 'Очередь 1', year: 2026, apartments, area: 139_500 * apartments / 1800 }],
  residentsOverride: Math.round(4650 * apartments / 1800), exits: [], kindergartenSeats: 0, schoolSeats: 0, retailArea: 0, parkingPlanned: 0, stoves: 'electric',
})

/** Пустая территория: сетка улиц без застройки и без садов и школ — ЖК ставится по данным, а модель показывает,
 *  что и сколько нужно построить рядом. Базовая загрузка улиц и остановок — малая (транзит), это синтетика. */
export const EMPTY_SITE: LngLat = [49.2594, 55.745]
const e = (dx: number, dy: number) => at(dx, dy, EMPTY_SITE)
const XS = [-1150, -900, -420, 420, 900, 1150], YS = [-1050, -800, -380, 380, 800, 1050]
const ROAD = (v: number) => (Math.abs(v) >= 1000 ? null : Math.abs(v) >= 800 ? ['primary', 6] as const : ['secondary', 4] as const)
const STREETS = ['Северная', 'Садовая', 'Школьная', 'Парковая', 'Луговая', 'Солнечная']
const eRoads: [string, string, number, LngLat[]][] = []
XS.forEach((x, i) => { const r = ROAD(x); if (r) eRoads.push([r[0], `улица ${STREETS[i]}`, r[1], [e(x, -1150), e(x, 1150)]]) })
YS.forEach((y, i) => { const r = ROAD(y); if (r) eRoads.push([r[0], `проспект ${['Мира', 'Победы', 'Строителей', 'Науки', 'Дружбы', 'Ветеранов'][i]}`, r[1], [e(-1150, y), e(1150, y)]]) })
const eNodes = [-900, -420, 420, 900].flatMap(x => [-800, -380, 380, 800].map(y => {
  const lanes = (Math.abs(x) === 900 ? 6 : 4) + (Math.abs(y) === 800 ? 6 : 4)
  const cap = Math.round(1840 * 0.45 * lanes / 2)
  return { id: `n${x}_${y}`, kind: 'intersection' as const, name: `Перекрёсток ${x < 0 ? 'З' : 'В'}${Math.abs(x)} × ${y < 0 ? 'Ю' : 'С'}${Math.abs(y)}`, coords: e(x, y), capacity: cap, load: Math.round(cap * 0.3),
    info: { load: { status: 'синтетика' as const, text: 'транзит по пустой территории, z = 0,3' } } }
}))
const eStops = ([[0, -380], [0, 380], [-420, 0], [420, 0]] as const).map(([x, y], i) => ({ id: `es${i}`, kind: 'stop' as const, name: `Остановка «${['Южная', 'Северная', 'Западная', 'Восточная'][i]}»`, coords: e(x, y), capacity: 1200, load: 150 }))
// кварталы между улицами — светлая подложка, крайние — парки
const edges = [-1150, -900, -420, 420, 900, 1150]
const eGround: [string, LngLat[]][] = []
for (let i = 0; i < edges.length - 1; i++) for (let j = 0; j < edges.length - 1; j++) {
  const pad = 14
  const [x0, x1, y0, y1] = [edges[i] + pad, edges[i + 1] - pad, edges[j] + pad, edges[j + 1] - pad]
  const park = (i === 0 || i === 4 || j === 0 || j === 4) && (i + j) % 3 === 0
  eGround.push([park ? 'park' : 'block', [e(x0, y0), e(x1, y0), e(x1, y1), e(x0, y1), e(x0, y0)]])
}
export const EMPTY_DISTRICT: District = {
  name: 'Пустая территория (синтетика)', synthetic: true, dataDate: '2026-10-01',
  sources: [{ title: 'Синтетическая территория без застройки', url: '', note: 'улицы, перекрёстки и остановки заданы вручную; садов и школ нет — всё нужное строится' }],
  objects: [...eNodes, ...eStops], roads: eRoads, ground: eGround, buildings: [],
}
