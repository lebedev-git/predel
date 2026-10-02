import { describe, expect, it } from 'vitest'
import { DEMOGRAPHY } from './coefficients'
import { buildProject } from '../data/synthetic'
import { defaultScenario, demand, powerPerApt, run, setPhaseApartments, type District, type Project, type Result, type Scenario } from './model'

// Контрольный сценарий ТЗ: ЖК 1 800 кв. → 4 650 жит.; спрос 410 мест в ДОО и 620 в школах; дефицит 170 / 240;
// утренний пик +780 авто и +1 050 поездок на ОТ; два перекрёстка в критической зоне.
// Площадь квартир в ТЗ не дана — восстановлена по норме МНГП: 4 650 × 30 = 139 500 м².
const C: [number, number] = [49.15, 55.79]
const at = (dx: number, dy: number): [number, number] => [C[0] + dx / 62600, C[1] + dy / 111200]

const project = (apartments = 1800, area = 139_500): Project => ({
  name: 'Тестовый ЖК',
  site: [at(-50, -50), at(50, -50), at(50, 50), at(-50, 50), at(-50, -50)],
  buildings: [],
  phases: [{ name: 'Очередь 1', year: 2026, apartments, area }],
  residentsOverride: apartments === 1800 ? 4650 : undefined,
  exits: [],
  kindergartenSeats: 0,
  schoolSeats: 0,
  retailArea: 0,
  parkingPlanned: 0,
  stoves: 'electric',
})

const district = (): District => ({
  name: 'Тестовый район',
  synthetic: true,
  dataDate: '2026-09-30',
  objects: [
    { id: 'kg1', kind: 'kindergarten', name: 'ДОО 1', coords: at(200, 0), capacity: 250, load: 100 },
    { id: 'kg2', kind: 'kindergarten', name: 'ДОО 2', coords: at(0, 250), capacity: 200, load: 110 },
    { id: 'kg3', kind: 'kindergarten', name: 'ДОО далеко', coords: at(900, 0), capacity: 600, load: 100 },
    { id: 's1', kind: 'school', name: 'Школа 1', coords: at(-300, 200), capacity: 1100, load: 720 },
    { id: 'x1', kind: 'intersection', name: 'Перекрёсток А', coords: at(300, 0), capacity: 1200, load: 900 },
    { id: 'x2', kind: 'intersection', name: 'Перекрёсток Б', coords: at(-300, 0), capacity: 1200, load: 900 },
    { id: 'st1', kind: 'stop', name: 'Остановка 1', coords: at(150, 150), capacity: 1600, load: 1200 },
  ],
})

// Контроль: пресет «Типовой (по примеру ТЗ)», без волны и когорт, без Монте-Карло, заселение сразу полное.
const scen = (patch: Partial<Scenario> = {}): Scenario => ({ ...defaultScenario(), years: 3, pace: [1], cohorts: false, wave: false, samples: 0, ...patch })
const val = (r: Result, key: string, i = 0) => r.years[i].metrics.find(m => m.key === key)!.value

describe('контрольный сценарий ТЗ', () => {
  const r = run(district(), project(), scen())

  it('население и прогнозная потребность', () => {
    expect(r.years[0].population).toBe(4650)
    expect(val(r, 'kg_scen')).toBe(410)
    expect(val(r, 'school_scen')).toBe(620)
  })

  it('дефицит в зоне доступности: дальний сад не учитывается', () => {
    expect(val(r, 'kg_def_scen')).toBe(170)
    expect(val(r, 'school_def_scen')).toBe(240)
  })

  it('поездки в утренний пик и два перекрёстка в критической зоне', () => {
    expect(val(r, 'car_trips')).toBe(780)
    expect(Math.abs(val(r, 'pt_trips') - 1050)).toBeLessThanOrEqual(10)
    expect(r.years[0].objects.filter(o => o.kind === 'intersection' && o.status === 'crit')).toHaveLength(2)
  })

  it('рекомендации со сроком, основанием и стоимостью', () => {
    const kg = r.recommendations.find(x => x.direction === 'Детские сады')!
    expect(kg.text).toContain('170')
    expect(kg.deadline).toContain('Очередь 1')
    expect(kg.basis).toContain('мест на 10 тыс. м²')
    expect(kg.cost).toBeGreaterThan(0)
    expect(r.recommendations.some(x => x.direction === 'Инженерные сети')).toBe(true)
  })
})

describe('нормативы МНГП Казани (от площади квартир)', () => {
  const r = run(district(), project(), scen())

  it('ДОО 24 и школы 47 мест на 10 тыс. м², население 30 м²/чел.', () => {
    expect(val(r, 'kg_norm')).toBe(335) // 139 500 × 24 / 10 000
    expect(val(r, 'school_norm')).toBe(656) // 139 500 × 47 / 10 000
    expect(val(r, 'populationNorm')).toBe(4650)
  })

  it('парковки: 1/80 + 1/560 м², округление вверх', () => {
    expect(val(r, 'parking_norm')).toBe(1994) // 1 744 + 250
  })

  it('норматив не зависит от темпа заселения, прогноз — зависит', () => {
    const slow = run(district(), project(), scen({ pace: [0.3, 0.6, 1] }))
    expect(val(slow, 'kg_norm')).toBe(335)
    expect(val(slow, 'kg_scen')).toBeLessThan(410)
  })

  it('электронагрузка по табл. 7.1 СП 256', () => {
    expect(powerPerApt(1000, 'electric')).toBeCloseTo(1.19)
    expect(powerPerApt(300, 'gas')).toBeCloseTo(0.74)
  })
})

describe('стресс-тест ТЗ: рост входных параметров меняет нагрузку и рекомендации', () => {
  const base = run(district(), project(), scen())

  it('больше квартир → больше нагрузка и другие рекомендации', () => {
    const big = run(district(), project(2700, 209_250), scen())
    expect(val(big, 'kg_def_scen')).toBeGreaterThan(val(base, 'kg_def_scen'))
    expect(val(big, 'car_trips')).toBeGreaterThan(val(base, 'car_trips'))
    expect(big.recommendations.map(x => x.text)).not.toEqual(base.recommendations.map(x => x.text))
  })

  it('выше коэффициент заселения → больше детей и поездок', () => {
    const p = project()
    delete p.residentsOverride
    const lo = run(district(), p, scen())
    const s = scen()
    s.coefs.occupancy.value = 2.9
    const hi = run(district(), p, s)
    expect(val(hi, 'kg_scen')).toBeGreaterThan(val(lo, 'kg_scen'))
    expect(val(hi, 'pt_trips')).toBeGreaterThan(val(lo, 'pt_trips'))
  })

  it('структура квартир по комнатности задаёт заселение', () => {
    const p = { ...project(), residentsOverride: undefined }
    const small = run(district(), { ...p, rooms: { studio: 0.5, one: 0.5, two: 0, three: 0 } }, scen())
    const family = run(district(), { ...p, rooms: { studio: 0, one: 0, two: 0.5, three: 0.5 } }, scen())
    expect(family.years[0].population).toBeGreaterThan(small.years[0].population * 1.5)
  })

  it('выше автомобилизация → больше поездок и переноса парковки', () => {
    const s = scen()
    s.coefs.motorization.value = 470
    const hi = run(district(), project(), s)
    expect(val(hi, 'car_trips')).toBeGreaterThan(val(base, 'car_trips'))
    expect(val(hi, 'parking_spill')).toBeGreaterThan(val(base, 'parking_spill'))
  })

  it('доля детей меняет дефицит и текст рекомендации', () => {
    const s = scen()
    s.coefs.share0to6.value = DEMOGRAPHY.young.share0to6
    const young = run(district(), project(), s)
    expect(val(young, 'kg_def_scen')).toBeGreaterThan(val(base, 'kg_def_scen'))
    expect(young.recommendations.find(x => x.direction === 'Детские сады')!.text).not.toEqual(base.recommendations.find(x => x.direction === 'Детские сады')!.text)
  })
})

describe('сроки и данные', () => {
  it('места в ЖК уменьшают дефицит только с года открытия', () => {
    const p = { ...project(), kindergartenSeats: 200, kindergartenYear: 2028 }
    const r = run(district(), p, scen())
    expect(val(r, 'kg_def_scen', 0)).toBe(170) // 2026 — сада ещё нет
    expect(val(r, 'kg_def_scen', 2)).toBe(0) // 2028 — открыт
  })

  it('нет данных о мощности → не «достаточно», а неизвестно; рекомендация запросить данные', () => {
    const d = district()
    delete d.objects[0].capacity
    const r = run(d, project(), scen())
    const def = r.years[0].metrics.find(m => m.key === 'kg_def_scen')!
    expect(def.value).toBe(320) // резерв ДОО 1 не подтверждён: 410 − 90
    expect(def.note).toContain('требует уточнения')
    expect(r.years[0].objects.find(o => o.id === 'kg1')!.status).toBe('unknown')
  })

  it('оценочная мощность: вывод только если верен на всём диапазоне', () => {
    const d = district()
    d.objects[3] = { ...d.objects[3], capacity: 1100, capacityRange: [600, 2000] }
    const r = run(d, project(), scen())
    expect(r.years[0].objects.find(o => o.id === 's1')!.status).toBe('uncertain')
  })

  it('известный резерв сетей: превышение → инженерная проверка', () => {
    const r = run(district(), { ...project(), networkReserve: { water: 100, power: 1e6 } }, scen())
    const t = r.recommendations.filter(x => x.direction === 'Инженерные сети').map(x => x.text).join(' ')
    expect(t).toContain('превышает известный резерв')
    expect(t).toContain('тепло') // резерв тепла не введён — запросить
    expect(t).not.toMatch(/электричество [0-9 ]+ кВт при резерве/)
  })

  it('мероприятия устраняют дефицит (третье состояние)', () => {
    const r = run(district(), project(), scen())
    const mits = r.recommendations.flatMap(x => (x.mitigation ? [x.mitigation] : []))
    const m = run(district(), project(), scen(), mits)
    // новые объекты вводятся не раньше срока стройки (сад 2028, школа 2029) — дефицит снят к последнему году
    expect(val(m, 'kg_def_scen', 3)).toBe(0)
    expect(val(m, 'school_def_scen', 3)).toBe(0)
    expect(val(m, 'kg_def_scen', 0)).toBeGreaterThan(0)
    expect(m.years[3].objects.filter(o => o.kind === 'intersection' && o.status === 'crit').length).toBeLessThan(2)
  })

  it('когорты рождений меняют базовую загрузку существующих объектов', () => {
    const r = run(district(), project(), { ...scen({ years: 10, cohorts: true }) })
    const s0 = r.years[0].objects.find(o => o.id === 's1')!.before!
    const s10 = r.years[10].objects.find(o => o.id === 's1')!.before!
    expect(s10).toBeLessThan(s0) // рождений после 2016 меньше — школьная когорта к 2036 снижается
  })
})

describe('неопределённость', () => {
  it('Монте-Карло воспроизводим и даёт P10 ≤ значение ≤ P90', () => {
    const s = scen({ samples: 300, pace: [0.5, 0.8, 1] })
    const a = run(district(), project(), s), b = run(district(), project(), s)
    const pa = a.years[2].metrics.find(m => m.key === 'car_trips')!
    const pb = b.years[2].metrics.find(m => m.key === 'car_trips')!
    expect([pa.p10, pa.p90]).toEqual([pb.p10, pb.p90])
    expect(pa.p10!).toBeLessThanOrEqual(pa.value)
    expect(pa.p90!).toBeGreaterThanOrEqual(pa.value)
    expect(a.tornado[1].bars.length).toBeGreaterThan(1)
  })

  it('волна: пик ДОО раньше пика школы', () => {
    const s = scen({ wave: true, years: 10 })
    const kg = Array.from({ length: 11 }, (_, i) => demand(project(), s, 2026 + i).kgScen)
    const sc = Array.from({ length: 11 }, (_, i) => demand(project(), s, 2026 + i).schoolScen)
    expect(kg.indexOf(Math.max(...kg))).toBeLessThan(sc.indexOf(Math.max(...sc)))
  })

  it('пересчёт реального масштаба быстрее 100 мс', () => {
    const d = district()
    for (let i = 0; i < 1000; i++) d.objects.push({ id: `o${i}`, kind: 'shop', name: 'м', coords: at((i % 40) * 50 - 1000, Math.floor(i / 40) * 50 - 600) })
    const t = performance.now()
    run(d, project(), { ...defaultScenario() })
    expect(performance.now() - t).toBeLessThan(100)
  })
})

describe('стресс-тест по пути интерфейса (штатные проекты)', () => {
  const site: [number, number] = C
  const s10 = () => scen({ years: 10, pace: [1], cohorts: false })

  it('ЖК-1: квартиры ×1,5 → население, норматив и поездки растут', () => {
    const p = buildProject('big', site)
    const q = setPhaseApartments(setPhaseApartments(p, 0, 1500), 1, 1200)
    const a = run(district(), p, s10()), b = run(district(), q, s10())
    expect(b.years[5].population).toBeGreaterThan(a.years[5].population * 1.45)
    expect(val(b, 'school_norm', 5)).toBeGreaterThan(val(a, 'school_norm', 5))
    expect(val(b, 'car_trips', 5)).toBeGreaterThan(val(a, 'car_trips', 5))
  })

  it('ЖК-2 (комнатность): ползунок коэффициента заселения работает', () => {
    const p = buildProject('small', site)
    const s = s10()
    const a = run(district(), p, s)
    s.coefs.occupancy.value = 2.9
    const b = run(district(), p, s)
    expect(b.years[5].population).toBeGreaterThan(a.years[5].population)
  })

  it('ЖК-1 (жители по проекту): одно деление ползунка заселения вверх → жителей и мест больше', () => {
    const p = buildProject('big', site)
    const s = s10()
    const a = run(district(), p, s)
    s.coefs.occupancy.value = 2.6
    const b = run(district(), p, s)
    expect(b.years[5].population).toBeGreaterThan(a.years[5].population)
  })

  it('поле квартир стёрли до 0 и набрали заново → площадь очереди не залипает в 0', () => {
    const p0 = buildProject('big', site)
    const p2 = setPhaseApartments(setPhaseApartments(p0, 0, 0), 0, 1500)
    expect(p2.phases[0].area).toBeGreaterThan(100_000)
    expect(p2.residentsOverride).toBeGreaterThan(p0.residentsOverride!)
  })

  it('ввод квартир по цифрам даёт то же, что вставка; через 0 жители по проекту не обнуляются', () => {
    const p0 = buildProject('big', site)
    const typed = [1, 15, 150, 1500].reduce((q, v) => setPhaseApartments(q, 0, v), setPhaseApartments(p0, 0, 0))
    const pasted = setPhaseApartments(p0, 0, 1500)
    expect(typed.phases[0].area).toBeCloseTo(pasted.phases[0].area, 6)
    const one = { ...p0, phases: [p0.phases[0]], residentsOverride: 2583 }
    const back = setPhaseApartments(setPhaseApartments(one, 0, 0), 0, 1000)
    expect(Math.abs(back.residentsOverride! - 2583) / 2583).toBeLessThan(0.01)
  })

  it('объяснение «почему так»: последний шаг цепочки равен показателю', () => {
    const r = run(district(), buildProject('big', site), s10())
    let n = 0
    for (const h of r.years) for (const m of h.metrics) if (m.steps?.length) {
      n++
      expect(Math.round(m.steps.at(-1)!.value), `${h.year} ${m.key}`).toBe(m.value)
    }
    expect(n).toBeGreaterThan(30)
  })

  it('диапазон P10–P90 следует за значением пользователя', () => {
    const s = scen({ samples: 300, pace: [1] })
    s.coefs.motorization.value = 550
    const m = run(district(), project(), s).years[1].metrics.find(x => x.key === 'car_trips')!
    expect(m.p10!).toBeLessThanOrEqual(m.value)
    expect(m.p90!).toBeGreaterThanOrEqual(m.value)
  })

  it('при избытке мест P90 дефицита — ноль; у каждого показателя есть уверенность', () => {
    const d = district()
    d.objects[0] = { ...d.objects[0], capacity: 5000 }
    const r = run(d, project(), scen({ samples: 200, pace: [1] }))
    const def = r.years[1].metrics.find(x => x.key === 'kg_def_scen')!
    expect(def.p90).toBe(0)
    expect(r.years[1].metrics.every(x => x.confidence)).toBe(true)
  })

  it('доли видов транспорта в сумме дают все поездки без авто', () => {
    const s = scen()
    s.coefs.shareTransit.value = 1
    const d = demand(project(), s, 2026)
    const nonCar = d.personTrips - d.carTrips * s.coefs.carOccupancy.value
    expect(d.ptTrips + d.walkTrips + d.bikeTrips).toBeCloseTo(nonCar)
  })
})

