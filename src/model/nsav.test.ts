import { describe, expect, it } from 'vitest'
import raw from '../../public/data/nsav-forecast.json?raw'
import { DEFAULT_PARAMS, forecast, prepare, type House, type Observed, type School } from './forecast'

// Проверка на истории: Ново-Савиновский район (pipeline/kzn/nsav/forecast_input.py). Модель с исходными параметрами
// (до калибровки) и поправкой каждой школы за 2020–2023 прогнозирует 2024–2026; сверка с 2024–2025 (госзадания — план
// на год) и 2026 (факт edu.tatar.ru). Гимназия № 107 открыта в 2023 — её прогноз целиком из модели.
// Подбор параметров на 2020–2023 здесь вырождается: 96% квартир в домах старше 15 лет, новых школ нет — данным не на чем
// различить волну и выбор школы. Подбирать — на районе с новыми ЖК (Азино) или на данных города.

const d = JSON.parse(raw)
const houses: House[] = d.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) =>
  ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined }))
const schools: School[] = d.schools
const observed: Observed = d.observed
const FIT = [2020, 2021, 2022, 2023], TEST = [2024, 2025, 2026]

const f = forecast(prepare(houses, schools), DEFAULT_PARAMS, TEST, { observed, anchorYears: FIT })
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const err = (t: number, pred: (j: number) => number | undefined) =>
  median(schools.flatMap((s, j) => { const v = observed[s.id]?.[TEST[t]], p = pred(j); return v === undefined || p === undefined ? [] : [Math.abs(p / v - 1)] }))
const model = (t: number) => err(t, j => f[j].pupils[t])
// наивный прогноз: последний известный год подбора
const naive = (t: number) => err(t, j => { const y = FIT.filter(y => observed[schools[j].id]?.[y] !== undefined).at(-1); return y === undefined ? undefined : observed[schools[j].id][y] })
const district = (t: number) => {
  const ok = schools.map((s, j) => [f[j].pupils[t], observed[s.id]?.[TEST[t]]] as const).filter(([, v]) => v !== undefined)
  return ok.reduce((a, [p]) => a + p, 0) / ok.reduce((a, [, v]) => a + v!, 0) - 1
}
const g107 = schools.findIndex(s => s.id === 'shkola-107-kzn')

describe('Ново-Савиновский: прогноз 2024–2026 по истории 2020–2023', () => {
  it('район в сумме — в пределах 5% все три года (сейчас +0,6% / −2,2% / +2,8%)', () => {
    TEST.forEach((_, t) => expect(Math.abs(district(t))).toBeLessThan(0.05))
  })

  it('по школе 2024–2025 точнее наивного «как в последний год» (сейчас 4,9% и 5,1% против 8,0% и 7,9%)', () => {
    expect(model(0)).toBeLessThan(naive(0))
    expect(model(1)).toBeLessThan(naive(1))
  })

  // 2026 — факт, а история — план госзаданий: план в среднем на 5–15% выше факта, модель продолжает «плановый» рост.
  // Наивный прогноз 2026 сейчас точнее (5,7% против 10,4%); тест держит нынешний уровень, чтобы ошибка не выросла незаметно.
  it('по школе 2026 (факт) — сейчас 10,4%, держим не хуже 15%', () => {
    expect(model(2)).toBeLessThan(0.15)
  })

  // Новая гимназия набирает учеников постепенно (1 323 → 2 015 → 2 260), модель раскладывает детей сразу:
  // в первый год завышение +47%, дальше +0,6% и −7,8%. Постепенный набор новой школы — следующая доработка.
  it('гимназия № 107 без истории: 2025–2026 в пределах 15%, первый год завышен (набор идёт постепенно)', () => {
    const e = TEST.map((y, t) => f[g107].pupils[t] / observed['shkola-107-kzn'][y] - 1)
    expect(Math.abs(e[1])).toBeLessThan(0.15)
    expect(Math.abs(e[2])).toBeLessThan(0.15)
    expect(e[0]).toBeLessThan(0.6)
  })
})
