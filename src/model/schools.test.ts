import { describe, expect, it } from 'vitest'
import raw from '../../public/data/kazan-schools.json?raw'

// Таблица школ Казани (pipeline/kzn/schools/school_table.py): мощность с источником и ученики по годам.
interface Row { inn: string; name: string; capacity: number | null; capLo: number | null; capHi: number | null; capSource: string; pupils: Record<string, number>; pupilsSource: Record<string, string> }
const d: { meta: { capacity: { looMedianError: number }; pupils: { planToFactMedian: number; archiveToReportMedian: number } }; schools: Row[] } = JSON.parse(raw)
const byName = (n: string) => d.schools.find(s => s.name.includes(n))!

describe('таблица школ Казани', () => {
  it('точная мощность у 31 школы: 17 из новостей мэрии, 14 с сайтов школ', () => {
    const exact = d.schools.filter(s => s.capSource === 'проект (новости мэрии)' || s.capSource === 'сайт школы')
    expect(exact.length).toBe(31)
    expect(byName('ГИМНАЗИЯ №107').capacity).toBe(1224)
    expect(byName('ШКОЛА №171').capacity).toBe(936)
    expect(byName('ЛИЦЕЙ №185').capacity).toBe(1501)
  })

  it('оценке по площади не доверяем, если по ней школа больше чем в двух сменах', () => {
    for (const s of d.schools.filter(s => s.capSource === 'оценка по площади')) {
      const now = s.pupils['2026']
      if (now) expect(now).toBeLessThanOrEqual(2 * s.capHi!)
      expect(s.capLo!).toBeLessThanOrEqual(s.capacity!)
      expect(s.capacity!).toBeLessThanOrEqual(s.capHi!)
    }
  })

  it('оценка по площади и эпохе на школах с известной мощностью ошибается в среднем меньше чем на 15%', () => {
    expect(d.meta.capacity.looMedianError).toBeLessThan(0.15)
  })

  it('ученики: план госзаданий совпадает с отчётным фактом, архив карточек — с отчётом (медианы в пределах 2%)', () => {
    expect(Math.abs(d.meta.pupils.planToFactMedian - 1)).toBeLessThan(0.02)
    expect(Math.abs(d.meta.pupils.archiveToReportMedian - 1)).toBeLessThan(0.02)
  })

  it('у каждой точки истории учеников указан источник', () => {
    for (const s of d.schools) expect(Object.keys(s.pupilsSource).sort()).toEqual(Object.keys(s.pupils).sort())
  })
})
