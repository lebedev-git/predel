import { describe, expect, it } from 'vitest'
import raw from '../../public/data/azino-forecast.json?raw'
import { DEFAULT_PARAMS, forecast, prepare, type House, type Observed, type Params, type School } from './forecast'

// Проверка на истории: Советский район (Азино), 39 школ, 150 тыс. квартир (pipeline/kzn/forecast_input.py).
// В 2017–2020 открылись шесть новых школ, после 2010 сдано 45 тыс. квартир — на этом районе подбор определяет волну.
// Подбор на 2018–2021 (госзадания — план на год), прогноз 2024–2026, сверка с 2024–2025 (план) и 2026 (факт edu.tatar.ru).

const d = JSON.parse(raw)
const houses: House[] = d.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) =>
  ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined }))
const schools: School[] = d.schools
const observed: Observed = d.observed
const P = prepare(houses, schools)
const FIT = [2018, 2019, 2020, 2021], TEST = [2024, 2025, 2026]

/** calibrate(P, observed, FIT) 03.11.2026, 98 точек (≈1 мин счёта).
 *  Волна Казани: в первые годы дома 0,8 от зрелого уровня, пик 1,2 — на 10–14-м году (немецкая форма: 0,64 → 1,0). */
const AZINO: Params = { ...DEFAULT_PARAMS, kpf: [0.207, 0.23, 0.261, 0.312, 0.256], beta: 0.47, gamma: 0.95, alpha: 0.01 }

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const isNew = (s: School) => s.openYear > 1960
function errors(p: Params) {
  const f = forecast(P, p, TEST, { observed, anchorYears: FIT })
  const ape = (t: number, only?: (s: School) => boolean) =>
    median(schools.flatMap((s, j) => ((only && !only(s)) || observed[s.id]?.[TEST[t]] === undefined ? [] : [Math.abs(f[j].pupils[t] / observed[s.id][TEST[t]] - 1)])))
  const district = (t: number) => {
    const ok = schools.map((s, j) => [f[j].pupils[t], observed[s.id]?.[TEST[t]]] as const).filter(([, v]) => v !== undefined)
    return ok.reduce((a, [p]) => a + p, 0) / ok.reduce((a, [, v]) => a + v!, 0) - 1
  }
  return { school: TEST.map((_, t) => ape(t)), fresh: TEST.map((_, t) => ape(t, isNew)), district: TEST.map((_, t) => district(t)) }
}
// наивный прогноз: последний известный год подбора
const naive = (t: number, only?: (s: School) => boolean) => median(schools.filter(s => !only || only(s)).flatMap(s => {
  const y = FIT.filter(y => observed[s.id]?.[y] !== undefined).at(-1), v = observed[s.id]?.[TEST[t]]
  return y === undefined || v === undefined ? [] : [Math.abs(observed[s.id][y] / v - 1)]
}))

describe('Азино: прогноз 2024–2026 по истории 2018–2021', () => {
  const before = errors(DEFAULT_PARAMS), fit = errors(AZINO)

  it('район в сумме — в пределах 5% (до подбора −0,2% / +1,7% / −0,2%, после −3,8% / −3,2% / −4,5%)', () => {
    for (const e of [...before.district, ...fit.district]) expect(Math.abs(e)).toBeLessThan(0.05)
  })

  it('по школе 2024–2025 подбор точнее и исходных параметров, и наивного (6,5% и 7,6% против 8,5% / 9,8% и 10,2% / 9,2%)', () => {
    for (const t of [0, 1]) {
      expect(fit.school[t]).toBeLessThan(before.school[t])
      expect(fit.school[t]).toBeLessThan(naive(t))
    }
  })

  // 2026 — факт, история — план госзаданий (план выше факта на 5–15%): наивный «как в 2021» сейчас точнее (8,3% против 12,9%).
  it('по школе 2026 (факт) — держим не хуже 15% (сейчас 12,9%)', () => {
    expect(fit.school[2]).toBeLessThan(0.15)
  })

  // Новые школы учат в 2–3 раза больше детей, чем живёт в их закреплении по OSM (лицей № 187: 2 200 учеников, около 1 000
  // квартир): часть домов новых ЖК в OSM без квартир и этажности, часть детей приходит из-за закрепления. Разделить без данных
  // города нельзя. Постепенный набор новой школы (притяжение растёт 4 года) проверяли 03.11: метрики не улучшил — убран.
  it('новые школы: модель точнее наивного «как в 2021»', () => {
    for (const t of [0, 1, 2]) expect(Math.max(before.fresh[t], fit.fresh[t])).toBeLessThan(naive(t, isNew))
  })
})
