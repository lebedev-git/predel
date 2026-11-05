import { describe, expect, it } from 'vitest'
import { birthFactor, calibrate, DEFAULT_PARAMS, expected, forecast, houseKids, prepare, shiftOf, type House, type Observed, type Params, type School } from './forecast'
import { at, demoCity, DEMO_YEARS, TRUE } from './demo'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('ядро прогноза: свойства', () => {
  const schools: School[] = [
    { id: 'a', coords: at(0, 0), openYear: 1970, design: 100 },
    { id: 'b', coords: at(2, 0), openYear: 1970, design: 100, magnet: true },
    { id: 'c', coords: at(1, 1), openYear: 2030 },
  ]
  const houses: House[] = [
    { id: '1', coords: at(0.2, 0), flats: 300, year: 2020, school: 'a' },
    { id: '2', coords: at(1.8, 0.1), flats: 200, year: 1985, school: 'b' },
  ]
  const P = prepare(houses, schools)

  it('дети дома: до сдачи 0, потом квартиры × заселено × учеников на квартиру × поправка на рождения', () => {
    expect(houseKids(houses[0], 2019, DEFAULT_PARAMS)).toBe(0)
    expect(houseKids(houses[0], 2021, DEFAULT_PARAMS, 0.9)).toBeCloseTo(300 * 0.8 * 0.21 * 0.9, 9)
    expect(houseKids(houses[1], 2026, DEFAULT_PARAMS)).toBeCloseTo(200 * 1 * 0.327, 9) // дом старше 15 лет — зрелый уровень
  })

  it('все дети дома распределяются по открытым школам: сумма по школам = сумма по домам', () => {
    const years = [2022, 2026]
    const m = expected(P, DEFAULT_PARAMS, years)
    years.forEach((y, t) => {
      expect(sum(m.map(r => r[t]))).toBeCloseTo(sum(houses.map(h => houseKids(h, y, DEFAULT_PARAMS, birthFactor(y)))), 6)
      expect(m[2][t]).toBe(0) // школа c ещё не открыта
    })
  })

  it('пока школа закрепления не открыта, бонус получает прежняя школа', () => {
    const h: House[] = [{ id: 'n', coords: at(1, 0.9), flats: 100, year: 2000, school: 'c', prev: 'b' }]
    const Q = prepare(h, schools)
    const [before] = expected(Q, DEFAULT_PARAMS, [2026])[1]
    const [none] = expected(prepare([{ ...h[0], prev: undefined }], schools), DEFAULT_PARAMS, [2026])[1]
    expect(before).toBeGreaterThan(none)
    expect(expected(Q, DEFAULT_PARAMS, [2031])[2][0]).toBeGreaterThan(expected(Q, DEFAULT_PARAMS, [2031])[1][0]) // c открылась — дети туда
  })

  it('закрепление и гимназия притягивают: больше бонус — больше детей', () => {
    const share = (p: Params) => expected(P, p, [2026])[0][0]
    expect(share({ ...DEFAULT_PARAMS, gamma: 3 })).toBeGreaterThan(share({ ...DEFAULT_PARAMS, gamma: 0 }))
    const magnet = (p: Params) => expected(P, p, [2026])[1][0]
    expect(magnet({ ...DEFAULT_PARAMS, alpha: 1 })).toBeGreaterThan(magnet({ ...DEFAULT_PARAMS, alpha: 0 }))
  })

  it('смены: до проектной — одна, до двух проектных — две, дальше — за пределом', () => {
    expect([shiftOf(100, 100), shiftOf(101, 100), shiftOf(200, 100), shiftOf(201, 100), shiftOf(50)]).toEqual(['одна смена', 'две смены', 'две смены', 'за пределом', 'нет данных'])
  })

  it('привязка к факту: поправка школы — средняя разница «факт − модель» за годы привязки', () => {
    const observed: Observed = { a: { 2022: 150 }, b: { 2022: 90 } }
    const f = forecast(P, DEFAULT_PARAMS, [2022, 2026], { observed, anchorYears: [2022] })
    expect(f[0].pupils[0]).toBeCloseTo(150, 9) // один год привязки: прогноз в нём равен факту
    const m = expected(P, DEFAULT_PARAMS, [2022, 2026])
    expect(f[0].pupils[1]).toBeCloseTo(150 + m[0][1] - m[0][0], 9)
    const two = forecast(P, DEFAULT_PARAMS, [2026], { observed: { a: { 2021: 140, 2022: 150 } }, anchorYears: [2021, 2022] })
    const m2 = expected(P, DEFAULT_PARAMS, [2021, 2022, 2026])
    expect(two[0].pupils[0]).toBeCloseTo(m2[0][2] + (140 - m2[0][0] + 150 - m2[0][1]) / 2, 9)
    expect(f[0].shift[0]).toBe('две смены')
    expect(f[0].secondShiftYear).toBe(2022)
  })
})

// ---------- Синтетический город ----------
// Истина задана заранее (demo.ts: TRUE). По ней сгенерирован «факт» учеников по школам 2016–2026 с шумом отчётности.
// Подбираем параметры на 2016–2022 и проверяем: вернулись ли заложенные, верен ли прогноз 2023–2026.
// Темп заселения модель берёт свой (50/80/95/100%), а истинный другой — проверка на неверное допущение.

const FIT = DEMO_YEARS.filter(y => y <= 2022), TEST = DEMO_YEARS.filter(y => y > 2022)
const syntheticCity = demoCity

describe('синтетический город: модель восстанавливает заложенную истину', () => {
  for (const seed of [1, 2]) {
    it(`город ${seed}: параметры вернулись, прогноз 2023–2026 точнее модели до калибровки`, () => {
      const { P, observed } = syntheticCity(seed)
      const { params: p } = calibrate(P, observed, FIT)
      // ступень 10–14 лет хуже всех представлена в годах подбора (такие дома есть только в первом квартале) — допуск 25%
      p.kpf.forEach((k, i) => expect(Math.abs(k / TRUE.kpf[i] - 1)).toBeLessThan(0.25))
      expect(Math.abs(p.beta / TRUE.beta - 1)).toBeLessThan(0.25)
      expect(Math.abs(p.gamma - TRUE.gamma)).toBeLessThan(0.35)
      expect(Math.abs(p.alpha - TRUE.alpha)).toBeLessThan(0.3)

      const opts = { observed, anchorYears: FIT }
      const err = (q: Params) => {
        const f = forecast(P, q, TEST, opts)
        const ape = P.schools.flatMap((s, j) => TEST.map((y, t) => observed[s.id][y] === undefined ? NaN : Math.abs(f[j].pupils[t] - observed[s.id][y]) / Math.max(observed[s.id][y], 1))).filter(x => !Number.isNaN(x)).sort((a, b) => a - b)
        const last = TEST.length - 1
        return {
          median: ape[Math.floor(ape.length / 2)],
          city: sum(f.map(x => x.pupils[last])) / sum(P.schools.map(s => observed[s.id][2026] ?? 0)) - 1,
          magnet: f[18].pupils[last] / observed.s18[2026] - 1, // новая гимназия, открыта в 2023 — нет в годах подбора
        }
      }
      const fit = err(p), before = err(DEFAULT_PARAMS)
      expect(Math.abs(fit.city)).toBeLessThan(0.03)
      expect(Math.abs(fit.magnet)).toBeLessThan(0.15)
      expect(fit.median).toBeLessThan(0.05)
      expect(fit.median).toBeLessThan(before.median)
      expect(Math.abs(fit.magnet)).toBeLessThan(Math.abs(before.magnet))
    }, 60_000)
  }
})
