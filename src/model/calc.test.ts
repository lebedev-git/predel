import { describe, expect, it } from 'vitest'
import forecastRaw from '../../public/data/kazan-forecast.json?raw'
import schoolsRaw from '../../public/data/kazan-schools.json?raw'
import { calcComplex, cityBase, joinCapacity, steps, type City, type CitySchool, type Complex } from './calc'
import { at, demoCity, DEMO_FIT, TRUE } from './demo'
import { birthFactor, DEFAULT_PARAMS, expected, houseKids, prepare } from './forecast'

const YEARS = Array.from({ length: 15 }, (_, i) => 2026 + i)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('калькулятор нового ЖК', () => {
  const schools: CitySchool[] = [
    { id: 'a', name: 'Школа № 1', coords: at(0, 0), openYear: 1970, design: 1000, cap: 'точно' },
    { id: 'b', name: 'Школа № 2', coords: at(3, 0), openYear: 1970, cap: 'нет данных' },
  ]
  const city: City = { schools, houses: [], years: YEARS, base: [YEARS.map(() => 600), YEARS.map(() => 500)] }
  const z: Complex = { coords: at(0.3, 0), phases: [{ year: 2028, flats: 1000 }], area: 50 }

  it('один дом даёт одно число в калькуляторе и в ядре', () => {
    const r = calcComplex(city, z, DEFAULT_PARAMS)
    YEARS.forEach((y, t) => {
      const core = houseKids({ id: 'x', coords: z.coords, flats: 1000, year: 2028 }, y, DEFAULT_PARAMS, birthFactor(y))
      expect(r.kids[t]).toBeCloseTo(core, 9)
      expect(steps(z, DEFAULT_PARAMS, y)[0].kids).toBeCloseTo(core, 9)
      expect(sum(r.schools.map(s => s.fromZhk[t]))).toBeCloseTo(core, 9)
    })
  })

  it('норматив: площадь квартир × 47 / 10 000 с года сдачи', () => {
    const r = calcComplex(city, z, DEFAULT_PARAMS)
    expect(r.norm[YEARS.indexOf(2027)]).toBe(0)
    expect(r.norm[YEARS.indexOf(2028)]).toBeCloseTo(235, 9)
  })

  it('не хватает мест: дети ЖК сначала занимают свободные места, сверх мощности — дефицит; школа без мощности — отдельно', () => {
    const r = calcComplex(city, z, DEFAULT_PARAMS)
    const a = r.schools.find(s => s.id === 'a')!, b = r.schools.find(s => s.id === 'b')!
    YEARS.forEach((_, t) => {
      expect(r.extra[t]).toBeCloseTo(Math.max(0, 600 + a.fromZhk[t] - 1000), 9)
      expect(r.unknown[t]).toBeCloseTo(b.fromZhk[t], 9)
    })
    const big = calcComplex(city, { ...z, phases: [{ year: 2028, flats: 3000 }] }, DEFAULT_PARAMS)
    expect(Math.max(...big.extra)).toBeGreaterThan(0)
  })

  it('своя школа ЖК снимает дефицит у соседей', () => {
    const big: Complex = { ...z, phases: [{ year: 2028, flats: 3000 }] }
    const without = calcComplex(city, big, DEFAULT_PARAMS), withOwn = calcComplex(city, { ...big, own: { design: 1100, year: 2029 } }, DEFAULT_PARAMS)
    const t = YEARS.indexOf(2035)
    expect(withOwn.extra[t]).toBeLessThan(without.extra[t])
    expect(withOwn.schools.find(s => s.id === 'own')!.load[t]).toBeGreaterThan(0)
  })
})

describe('Казань: мощности к школам модели', () => {
  const f = JSON.parse(forecastRaw), t = JSON.parse(schoolsRaw)
  const joined = joinCapacity(f.schools, t.schools)
  it('все 150 школ сопоставлены: 29 точно, 99 оценка, 22 нет данных; гимназия № 107 — 1 224 места', () => {
    const count = (c: string) => joined.filter(s => s.cap === c).length
    expect([count('точно'), count('оценка'), count('нет данных')]).toEqual([29, 99, 22])
    expect(joined.find(s => s.name === 'Гимназия № 107')!.design).toBe(1224)
  })
})

describe('демо-город: калькулятор на подобранных параметрах повторяет заложенную истину', () => {
  const { P, houses, schools, observed } = demoCity(1)
  const cs: CitySchool[] = schools.map(s => ({ ...s, cap: 'демо' }))
  const model = cityBase(houses, cs, observed, DEMO_FIT, YEARS, [2024, 2025, 2026])
  const truth: City = { schools: cs, houses, years: YEARS, base: expected(P, TRUE, YEARS) }
  const z: Complex = { coords: at(4, 4), phases: [{ year: 2028, flats: 800 }, { year: 2030, flats: 800 }], area: 55 }
  const m = calcComplex(model, z, DEMO_FIT), tr = calcComplex(truth, z, TRUE)

  it('дети ЖК: пик и сумма за 15 лет — в пределах 5% от истины', () => {
    expect(Math.abs(Math.max(...m.kids) / Math.max(...tr.kids) - 1)).toBeLessThan(0.05)
    expect(Math.abs(sum(m.kids) / sum(tr.kids) - 1)).toBeLessThan(0.05)
  })

  it('загрузка трёх главных школ ЖК в 2035 — в пределах 10% от истины', () => {
    const t = YEARS.indexOf(2035)
    for (const s of m.schools.slice(0, 3)) expect(Math.abs(s.load[t] / tr.schools.find(x => x.id === s.id)!.load[t] - 1)).toBeLessThan(0.1)
  })

  it('прогноз без ЖК привязан к факту демо-города', () => {
    expect(prepare(houses, cs).schools.length).toBe(19)
    expect(Math.abs(model.base[0][0] / observed.s0[2026] - 1)).toBeLessThan(0.1)
  })
})
