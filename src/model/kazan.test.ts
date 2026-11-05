import { describe, expect, it } from 'vitest'
import raw from '../../public/data/kazan-forecast.json?raw'
import { AZINO_PARAMS, DEFAULT_PARAMS, forecast, prepare, type House, type Observed, type Params, type School } from './forecast'

// Вся Казань: 150 школ 7 районов, 520 тыс. квартир, у 128 школ есть история (pipeline/kzn/combine_city.py). Дети
// распределяются по школам через границы районов. На городе параметры не подбирались: исходные и подобранные на Азино.
// Привязка к факту 2018–2021, прогноз 2024–2026, сверка с 2024–2025 (госзадания, совпадают с отчётным фактом) и 2026 (карточки edu.tatar.ru).

const d = JSON.parse(raw)
const houses: House[] = d.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) =>
  ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined }))
const schools: School[] = d.schools
const observed: Observed = d.observed
const P = prepare(houses, schools)
const FIT = [2018, 2019, 2020, 2021], TEST = [2024, 2025, 2026]
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function errors(p: Params) {
  const f = forecast(P, p, TEST, { observed, anchorYears: FIT })
  const school = TEST.map((y, t) => median(schools.flatMap((s, j) => (observed[s.id]?.[y] === undefined ? [] : [Math.abs(f[j].pupils[t] / observed[s.id][y] - 1)]))))
  const city = TEST.map((y, t) => {
    const ok = schools.map((s, j) => [f[j].pupils[t], observed[s.id]?.[y]] as const).filter(([, v]) => v !== undefined)
    return ok.reduce((a, [p]) => a + p, 0) / ok.reduce((a, [, v]) => a + v!, 0) - 1
  })
  return { school, city }
}
// наивный прогноз: последний известный год до 2022
const naive = TEST.map(y => median(schools.flatMap(s => {
  const b = FIT.filter(x => observed[s.id]?.[x] !== undefined).at(-1), v = observed[s.id]?.[y]
  return b === undefined || v === undefined ? [] : [Math.abs(observed[s.id][b] / v - 1)]
})))

describe('Казань: прогноз по каждой школе 2024–2026', () => {
  const base = errors(DEFAULT_PARAMS), azino = errors(AZINO_PARAMS)

  it('город в сумме с исходными параметрами — в пределах 3% (−0,9% / −0,4% / −1,7%); с параметрами Азино занижен (−5,2% / −5,7% / −7,1%)', () => {
    base.city.forEach(e => expect(Math.abs(e)).toBeLessThan(0.03))
    azino.city.forEach(e => expect(Math.abs(e)).toBeLessThan(0.08))
  })

  it('по школе 2024–2025 точнее наивного (исходные 7,4% / 7,3%, Азино 7,0% / 7,2%, наивный 9,3% / 9,2%)', () => {
    for (const t of [0, 1]) for (const e of [base.school[t], azino.school[t]]) expect(e).toBeLessThan(naive[t])
  })

  // 2026: спад учеников модель недоучитывает; исходные 10,7%, Азино 8,4%, наивный 8,2%.
  it('по школе 2026 (факт) — не хуже 12%', () => {
    expect(base.school[2]).toBeLessThan(0.12)
    expect(azino.school[2]).toBeLessThan(0.12)
  })
})
