import { describe, expect, it } from 'vitest'
import kazanRaw from '../../public/data/kazan.json?raw'
import { DEFAULT_COEFS } from './coefficients'
import { bestSeed, clusterOf, retroCheck, retroSummary } from './retro'

describe('проверка на построенных ЖК', () => {
  const d = JSON.parse(kazanRaw)

  it('ЖК — дома одного года рядом; цепочка объяснения сходится с прогнозом и фактом', () => {
    const seed = bestSeed(d, DEFAULT_COEFS)!
    const cl = clusterOf(d, seed)
    expect(cl.length).toBeGreaterThan(1)
    const years = cl.map(i => d.buildings[i][4])
    expect(Math.max(...years) - Math.min(...years)).toBeLessThanOrEqual(2)
    const r = retroCheck(d, cl, DEFAULT_COEFS)!
    const st = r.school.steps
    expect(st[2].value).toBeCloseTo(r.school.pred, 6)
    expect(st[3].value).toBe(r.school.fact)
    expect(st.at(-1)!.value).toBeCloseTo(((r.school.pred - r.school.fact) / r.school.fact) * 100, 6)
  })

  // Известное ограничение: модель 3D-экрана «Новый ЖК» по сумме новых ЖК Азино ошибается на ~20%.
  // Цель пилота — ±15% (docs/ПИЛОТ.md); тест держит нынешний уровень, чтобы ошибка не выросла незаметно.
  it('Азино: прогноз по школам в сумме по новым ЖК — сейчас в пределах ±25% от факта (цель пилота ±15%)', () => {
    const s = retroSummary(d, DEFAULT_COEFS)
    expect(s.zones).toBeGreaterThan(30)
    expect(Math.abs(s.total)).toBeLessThan(0.25)
  })
})
