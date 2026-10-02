import { describe, expect, it } from 'vitest'
import { importFile, mergeObjects } from './io'
import kazanRaw from '../public/data/kazan.json?raw'
import sample from '../samples/ПРИМЕР-мощности-ЦГТ.csv?raw'

describe('импорт данных', () => {
  const kazan = JSON.parse(kazanRaw)

  it('таблица мощностей поверх Казани: факт вместо оценки, здания на месте', () => {
    const f = 'ПРИМЕР-мощности-ЦГТ.csv'
    const r = importFile(sample, f)
    if (r.type !== 'district') throw new Error('ожидался район')
    const m = mergeObjects(kazan, r.district.objects, f)
    expect([m.matched, m.added]).toEqual([2, 0])
    const kg = m.district.objects.find(o => o.id === 'kg163')!
    expect([kg.capacity, kg.capacityRange, kg.info?.capacity?.status]).toEqual([140, undefined, 'факт'])
    expect(m.district.buildings!.length).toBe(kazan.buildings.length)
  })

  it('GeoJSON с русскими ключами и полигоном участка', () => {
    const g = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'вид': 'школа', 'название': 'Школа № 5', 'мощность': 825 },
      geometry: { type: 'Polygon', coordinates: [[[49, 55], [49.002, 55], [49.002, 55.002], [49, 55.002], [49, 55]]] } }] }
    const r = importFile(JSON.stringify(g), 'a.geojson')
    if (r.type !== 'district') throw new Error('ожидался район')
    expect(r.district.objects[0]).toMatchObject({ kind: 'school', capacity: 825 })
    expect(r.district.objects[0].coords[0]).toBeCloseTo(49.001, 3)
  })

  it('JSON с русскими ключами и долготой/широтой; повторная загрузка не плодит источники', () => {
    const j = { objects: [{ 'вид': 'школа', 'название': 'Школа № 7', 'долгота': 49.2235, 'широта': 55.7624, 'мощность': 1200, 'загрузка': 1100 }] }
    const r = importFile(JSON.stringify(j), 'ru.json')
    if (r.type !== 'district') throw new Error('ожидался район')
    expect(r.district.objects[0]).toMatchObject({ kind: 'school', capacity: 1200 })
    const kazan = JSON.parse(kazanRaw)
    const m1 = mergeObjects(kazan, r.district.objects, 'ru.json')
    const m2 = mergeObjects(m1.district, r.district.objects, 'ru.json')
    expect(m2.district.sources!.filter(x => x.title === 'Файл «ru.json»').length).toBe(1)
    expect(m2.district.name.split(' + ru.json').length).toBe(2)
  })
})
