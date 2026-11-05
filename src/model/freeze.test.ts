/// <reference types="node" />
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import forecastRaw from '../../public/data/kazan-forecast.json?raw'
import schoolsRaw from '../../public/data/kazan-schools.json?raw'
import frozenRaw from '../../public/data/frozen-2027.json?raw'
import { joinCapacity } from './calc'
import { AZINO_PARAMS, DEFAULT_PARAMS, forecast, prepare, type House } from './forecast'

// Прогноз по каждой школе Казани на сентябрь 2027, замороженный 05.11.2026: проверка на будущем, которое модель не видела.
// Пересоздать (только если решено заморозить заново): FREEZE=1 npx vitest run src/model/freeze.test.ts
// После 01.10.2027 сверить с карточками edu.tatar.ru и отчётами bus.gov.ru.

// Привязка к последнему году факта. Проверка на истории 05.11.2026 (медиана ошибки по школе, 127 школ):
// 2026 по 2025 — 4,1% (Азино 3,7%), по 2024–2025 — 5,2%, по 2021–2025 — 6,8%; новые школы 10% против 14%: они ещё набирают
// учеников, и среднее за несколько лет тянет их вниз. Прогноз «как в прошлом году» — 3,7%: на год вперёд модель с ним наравне,
// её выигрыш — на 3–5 лет и там, где появляются новые дома и школы (kazan.test.ts).
const ANCHOR = [2026]

describe('заморозка прогноза на сентябрь 2027', () => {
  it.runIf(process.env.FREEZE === '1')('пишет public/data/frozen-2027.json', () => {
    const d = JSON.parse(forecastRaw), t = JSON.parse(schoolsRaw)
    const houses: House[] = d.houses.map(([id, lon, lat, flats, year, school, prev]: [string, number, number, number, number, string | null, string | null]) =>
      ({ id, coords: [lon, lat], flats, year, school: school ?? undefined, prev: prev ?? undefined }))
    const schools = joinCapacity(d.schools, t.schools)
    const P = prepare(houses, schools)
    const base = forecast(P, DEFAULT_PARAMS, [2027], { observed: d.observed, anchorYears: ANCHOR })
    const azino = forecast(P, AZINO_PARAMS, [2027], { observed: d.observed, anchorYears: ANCHOR })
    const out = {
      frozen: '2026-11-05', target: '2027-09', model: 'src/model/forecast.ts, ветка model-core',
      method: 'дома и закрепление 2026 + стройки Госстройнадзора; поправка школы по факту 2026; параметры исходные (pupils) и подбор Азино (pupilsAzino)',
      schools: schools.map((s, j) => ({
        id: s.id, name: s.name, district: (d.schools[j] as { district?: string }).district, design: s.design ?? null, cap: s.cap,
        fact2026: d.observed[s.id]?.[2026] ?? null, pupils: Math.round(base[j].pupils[0]), pupilsAzino: Math.round(azino[j].pupils[0]), shift: base[j].shift[0],
      })),
    }
    writeFileSync('public/data/frozen-2027.json', JSON.stringify(out, null, 1))
  })

  it('файл заморожен 05.11.2026, в нём все 150 школ с прогнозом', () => {
    const f = JSON.parse(frozenRaw)
    expect(f.frozen).toBe('2026-11-05')
    expect(f.schools.length).toBe(150)
    for (const s of f.schools) expect(s.pupils).toBeGreaterThanOrEqual(0)
  })
})
