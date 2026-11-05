import { describe, expect, it } from 'vitest'
import raw from '../../public/data/azino-forecast.json?raw'
import { AZINO_PARAMS, DEFAULT_PARAMS, forecast, prepare, type House, type Observed, type Params, type School } from './forecast'

// Проверка на истории: Советский район (Азино), 39 школ, 157 тыс. квартир (pipeline/kzn/forecast_input.py; год ввода
// и квартиры МКД — реестр капремонта АИС «ФРТ», остальное — OSM). В 2017–2020 открылись шесть новых школ, после 2010 сдано
// 43 тыс. квартир — на этом районе подобраны AZINO_PARAMS: calibrate(P, observed, [2018…2021]), ≈40 с.
// Прогноз 2024–2026, сверка с 2024–2025 (госзадания — план на год) и 2026 (факт edu.tatar.ru).

const d = JSON.parse(raw)
const houses: House[] = d.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) =>
  ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined }))
const schools: School[] = d.schools
const observed: Observed = d.observed
const P = prepare(houses, schools)
const FIT = [2018, 2019, 2020, 2021], TEST = [2024, 2025, 2026]

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
  const before = errors(DEFAULT_PARAMS), fit = errors(AZINO_PARAMS)

  it('район в сумме: исходные параметры — в пределах 3% (−0,7% / +1,0% / −0,9%), подбор занижает до 6% (−5,0% / −4,6% / −6,0%)', () => {
    before.district.forEach(e => expect(Math.abs(e)).toBeLessThan(0.03))
    fit.district.forEach(e => expect(Math.abs(e)).toBeLessThan(0.07))
  })

  it('по школе 2024–2025 обе версии точнее наивного (исходные 8,9% / 7,4%, подбор 7,4% / 7,9%, наивный 10,2% / 9,2%)', () => {
    for (const t of [0, 1]) for (const e of [before.school[t], fit.school[t]]) expect(e).toBeLessThan(naive(t))
  })

  // 2026 — карточки edu.tatar.ru; спад учеников в 2026 году модель недоучитывает: наивный «как в 2021» точнее (8,3% против 10,8% / 11,7%).
  it('по школе 2026 (факт) — держим не хуже 12%', () => {
    expect(before.school[2]).toBeLessThan(0.12)
    expect(fit.school[2]).toBeLessThan(0.12)
  })

  // Новые школы учат в 2–3 раза больше детей, чем живёт в их закреплении по открытым данным (лицей № 187: 2 200 учеников,
  // около 1 000 квартир): часть детей приходит из-за закрепления, часть домов новых ЖК не учтена. Разделить без данных города
  // нельзя. Исходные параметры: 19,3% / 13,8% / 10,8% против наивного 23,7% / 25,5% / 24,9%; подбор хуже (21–31%).
  // Постепенный набор новой школы (притяжение растёт 4 года) проверяли 03.11: метрики не улучшил — убран.
  it('новые школы: исходные параметры точнее наивного', () => {
    for (const t of [0, 1, 2]) expect(before.fresh[t]).toBeLessThan(naive(t, isNew))
  })
})
