import { describe, expect, it } from 'vitest'
import kazanRaw from '../../public/data/kazan.json?raw'
import nsavRaw from '../../public/data/kazan-nsav.json?raw'
import { EMPTY_DISTRICT, EMPTY_SITE, KAZAN_SITE, NSAV_SITE, buildProject } from '../data/synthetic'
import { centroid } from './geo'
import { overlaps, placeFacilities, plotArea, siteConflict, type Facility } from './place'

const NEED: Facility[] = [
  { id: 'kg-1', kind: 'kindergarten', amount: 220, year: 2028, label: 'сад' },
  { id: 'kg-2', kind: 'kindergarten', amount: 220, year: 2028, label: 'сад' },
  { id: 'sc-1', kind: 'school', amount: 1224, year: 2029, label: 'школа' },
  { id: 'pk-1', kind: 'parking', amount: 745, year: 2027, label: 'паркинг' },
]

describe('размещение новых объектов', () => {
  it('нормативные участки: сад 38 м²/место, школа 24 м²/ученика (СП 42, табл. Д.1, изм. 3)', () => {
    expect(plotArea('kindergarten', 220)).toBe(8360)
    expect(plotArea('kindergarten', 80)).toBe(3520)
    expect(plotArea('school', 1224)).toBe(29376)
  })

  for (const [name, district, site] of [['пустая территория', EMPTY_DISTRICT, EMPTY_SITE], ['Казань, Азино', JSON.parse(kazanRaw), KAZAN_SITE], ['Казань, Ново-Савиновский', JSON.parse(nsavRaw), NSAV_SITE]] as const) {
    it(`${name}: участки не на зданиях, не на дорогах, не на ЖК и не друг на друге`, () => {
      const p = buildProject(name.includes('Ново') ? 'small' : 'big', site)
      const placed = placeFacilities(district, p, NEED, centroid(p.site))
      for (const x of placed.filter(q => q.found)) expect(overlaps(district, x), `${x.id} в ${x.dist} м`).toBeNull()
      const ok = placed.filter(q => q.found)
      for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
        const [a, b] = [ok[i], ok[j]]
        const dx = Math.abs(a.center[0] - b.center[0]) * 62_600, dy = Math.abs(a.center[1] - b.center[1]) * 111_200
        expect(dx >= (a.w + b.w) / 2 || dy >= (a.d + b.d) / 2, `${a.id} и ${b.id}`).toBe(true)
      }
      if (name === 'пустая территория') expect(placed.every(x => x.inRadius)).toBe(true)
    })
  }

  it('участок ЖК на дороге — предупреждение; на пустом месте — нет', () => {
    const p = buildProject('big', EMPTY_SITE)
    expect(siteConflict(EMPTY_DISTRICT, p)).toBeNull()
    const onRoad = buildProject('big', [EMPTY_SITE[0], EMPTY_SITE[1] - 380 / 111_200])
    expect(siteConflict(EMPTY_DISTRICT, onRoad)).toBe('дорогу')
    expect(siteConflict(JSON.parse(kazanRaw), buildProject('big', KAZAN_SITE))).toBeNull()
    expect(siteConflict(JSON.parse(nsavRaw), buildProject('small', NSAV_SITE))).toBeNull()
  })
})
