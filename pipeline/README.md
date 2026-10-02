# pipeline — сбор данных и расчёт для «Графиков», «Как считаем» и проверки на истории

Python 3.10+. Скрипты скачивают открытые данные, считают прогноз и проверку на истории и собирают JSON,
которые читают страницы `public/dash/*.html` и 3D-экран гимназии № 107.
Персональные данные не собираются: у учреждений — название, ИНН, адрес и число учеников;
частные сады индивидуальных предпринимателей обезличивает `scripts/sync_dash.py` (с проверкой на утечки).

**Рабочие папки.** Скрипты писались в рабочих папках, пути к ним заданы в начале файлов:

| Здесь | Рабочая папка |
|---|---|
| `pipeline/kazan.py` | `C:/tmp/demo/kzn/` |
| `pipeline/goroda/` | `C:/tmp/demo/kzn/goroda/` |
| `pipeline/goroda/map/` | `C:/tmp/demo/kzn/goroda/map/` |
| `pipeline/kzn/`, `pipeline/inputs/` | `C:/tmp/kzn/` |
| `pipeline/kzn/nsav/` | `C:/tmp/kzn/nsav/` |

Чтобы пересобрать данные, разложите скрипты по этим папкам (или поменяйте пути в начале файлов) и запускайте по порядку.

## Порядок

| Шаг | Скрипты | Что получается |
|---|---|---|
| 1. Ученики и рождения Казани | `goroda/fetch_goroda.py`, `tatar_tables.py`, `kazan_series.py`, `fetch_bdpmo.py`, `fetch_news.py` | ряды Росстата и Татарстанстата, ученики 2016–2026 по заявлениям мэрии и министерства (`news.json`) |
| 2. Модель города и проверка из 2015 | `goroda/model_city.py`, `chart_city.py` | `kazan_pupils.json`: факт 2002–2026, «ученики = k × родившиеся 7–17 лет назад», прогноз из 2015 и из 9 стартовых лет |
| 3. Дети по районам | `kazan.py`, `goroda/fetch_osm_districts.py`, `kzn/scrape_edu.py`, `goroda/coef_districts.py` | дети по возрасту (Татарстанстат на 01.01.2024), квартиры (OSM), ученики школ (edu.tatar.ru) → `coef_districts.json` — школьников на квартиру по районам |
| 4. Стройки | `goroda/fetch_gsn.py`, `gsn_layer.py`, `gsn_forecast.py` | реестр Госстройнадзора РТ → `gsn/objects.json`; формула «новый дом → дети»: квартиры × заселение × уровень района × волна |
| 5. Учреждения и места | `kzn/join_schools.py`, `kzn/osm_capacity.py`, `kzn/capacity_load.py` | единая таблица школ и садов; места: у новых школ — по новостям (`inputs/new_schools_capacity.json`), у остальных — по площади здания с проверкой «без одной» |
| 6. История района по госзаданиям | `kzn/nsav/bus_fast.py`, `bus_fill.py`, `bus_city.py`, `parse2.py`, `yield2.py`, `backtest.py`, `nsav_history.py` | ученики по годам (bus.gov.ru), закрепление домов (постановления ИКМО), проверка Ново-Савиновского района из 2021 → `public/data/nsav-history.json` |
| 7. Сборка дашборда | `goroda/map/charts_data.py`, `goroda/map/dash_data.py`, затем `scripts/sync_dash.py` | `charts.json`, `dash_data.json` → `public/dash/*.json` (+ `validation.json`, `planned.json`, `formula.json`) |

## Ручные входы

- возрастной состав населения районов Казани на 01.01.2024 — Татарстанстат (`vps2024.docx`);
- реестр образовательных организаций Рособрнадзора (zip-выгрузка);
- `tatarstan.osm.pbf` — выгрузка OpenStreetMap (Geofabrik);
- `inputs/new_schools_capacity.json` — места 17 новых школ, `inputs/planned_edu.json` — строящиеся и объявленные школы и сады:
  собраны вручную по новостям мэрии и СМИ, у каждой цифры — цитата и ссылка, цитаты подтверждены повторной загрузкой страниц.

Нужны `curl` и, для части таблиц, LibreOffice (конвертация документов Татарстанстата).
