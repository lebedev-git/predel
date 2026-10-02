"""Дети Казани и её районов до 2036 + проверка метода на прошлом (Татарстан, прогноз от 2014 против факта 2024).

Данные (C:/tmp/demo/kzn):
  vps2023.docx, vps2024.docx — Татарстанстат, население по полу и однолетним возрастам: Казань (табл. 12) и 7 районов (табл. 13)
  rt_age_2012_2022.xlsx      — Татарстанстат, население РТ по возрастам 2012–2022 (пересчёт по ВПН-2020)
  BRa1989-2014.txt, PopBa*   — РосБРиС: возрастная рождаемость и женщины по возрастам, Татарстан Reg=1192
  ../rosbris/BRa2012-2023.txt, ../pv2024/Бюллетень_2024.xlsx — то же, что в ../forecast.py
Миграция = сдвиг когорт 01.01.2023 → 01.01.2024 (в остатке и смерти); один год — грубо, поэтому сценарий и без неё.
"""
import csv
import docx
import openpyxl

# Рождения в Казани: 2010–2021 БД ПМО, 2022 Татарстанстат (MO-23.pdf), 2023–2024 Татар-информ
KZN_BIRTHS = {2018: 17566, 2019: 15760, 2020: 15264, 2021: 15810, 2022: 13977, 2023: 13640, 2024: 13227}
TFR_FACT = {2024: 1.451, 2025: 1.434}
YEARS = range(2024, 2036)  # годы рождений; итог — на 01.01.2036


def age_of(label):
    s = label.strip()
    return 0 if s.startswith('до 1') else int(s) if s.isdigit() else None


def docx_areas(path):
    """{'Казань': {возраст: (оба пола, женщины)}, '<район>': {...}} из табл. 12 (город) и 13 (районы)."""
    d = docx.Document(path)
    out = {'Казань': {}}
    for r in d.tables[12].rows:
        a = age_of(r.cells[0].text)
        if a is not None:
            out['Казань'][a] = (int(r.cells[1].text), int(r.cells[3].text))
    cur = None
    for r in d.tables[13].rows:
        lab = r.cells[0].text.strip()
        if 'район' in lab:
            cur = lab.replace('-ный', 'ный')
            out[cur] = {}
        elif cur and (a := age_of(lab)) is not None:
            out[cur][a] = (int(r.cells[1].text), int(r.cells[3].text))
    return out


def asfr_tt(path, year):
    for r in csv.DictReader(open(path, encoding='utf-8')):
        if r['Year'] == str(year) and r['Reg'] == '1192' and r['Group'] == 'T':
            return {int(k[3:]): float(v) / 1e6 for k, v in r.items() if k.startswith('Bra')}


def raw_births(women, asfr):
    return sum(f * (women.get(a, 0) + women.get(a - 1, 0)) / 2 for a, f in asfr.items())


def project(pop, women, asfr, k, tfr_mult, mig=None, mig_w=None, years=YEARS):
    """Передвижка по годам. pop/women — {возраст: человек} на 01.01 первого года. Возвращает население на 01.01 после последнего года и рождения."""
    pop, women, births = dict(pop), dict(women), {}
    mig, mig_w = mig or {}, mig_w or {}
    for y in years:
        b = raw_births(women, asfr) * k * tfr_mult(y)
        births[y] = b
        pop = {0: b + mig.get(-1, 0), **{a + 1: n + mig.get(a, 0) for a, n in pop.items()}}
        women = {0: b * 0.487 + mig_w.get(-1, 0), **{a + 1: n + mig_w.get(a, 0) for a, n in women.items()}}  # 0,487 — доля девочек при рождении
    return pop, births


def tfr_path(name):
    """Множитель рождаемости к 2024: те же сценарии, что в ../forecast.py."""
    ros = [1.343, 1.363, 1.386, 1.423, 1.458, 1.484, 1.507, 1.533, 1.562, 1.575, 1.591, 1.609]  # Росстат, РТ, 2025–2036
    def f(y):
        if y <= 2025: return TFR_FACT[max(y, 2024)] / TFR_FACT[2024]
        t = {'низкий': 1.434 * 0.98 ** (y - 2025), 'базовый': 1.434, 'высокий': 1.434 * ros[y - 2025] / ros[0]}[name]
        return t / TFR_FACT[2024]
    return f


def grp(pop, lo, hi):
    return sum(pop.get(a, 0) for a in range(lo, hi + 1))


GROUPS = [('0–17', 0, 17), ('сад 1–6', 1, 6), ('школа 7–17', 7, 17)]


def area_inputs(a23, a24, area):
    """Население и женщины на 01.01.2024 + миграция как сдвиг когорт 2023→2024 (в остатке и смерти)."""
    p24, w24 = {a: v[0] for a, v in a24[area].items()}, {a: v[1] for a, v in a24[area].items()}
    p23, w23 = {a: v[0] for a, v in a23[area].items()}, {a: v[1] for a, v in a23[area].items()}
    mig = {a: p24.get(a + 1, 0) - p23.get(a, 0) for a in range(99)}
    mig_w = {a: w24.get(a + 1, 0) - w23.get(a, 0) for a in range(99)}
    return p24, w24, mig, mig_w


def kazan():
    a23, a24 = docx_areas('vps2023.docx'), docx_areas('vps2024.docx')
    asfr = asfr_tt('../rosbris/BRa2012-2023.txt', 2023)
    # калибровка рождаемости на город: модель даёт факт 2024 по Казани
    w24 = {a: v[1] for a, v in a24['Казань'].items()}
    k_city = KZN_BIRTHS[2024] / raw_births(w24, asfr)
    print(f'Казань: калибровка рождаемости Татарстана к факту 2024 — ×{k_city:.3f} (>1 — в городе рожают чаще, чем в среднем по республике)')
    print(f'Население 01.01.2023 → 01.01.2024: {sum(v[0] for v in a23["Казань"].values()):,} → {sum(v[0] for v in a24["Казань"].values()):,}'.replace(',', ' '))

    hdr = f'{"":24}' + ''.join(f'{g:>22}' for g, *_ in GROUPS)
    print('\nДети на 01.01, тыс.: 2024 → 2030 → 2036, базовый сценарий (рождаемость 2025), с миграцией 2023 г. [без миграции 2036]')
    print(hdr)
    for area in a24:
        p24, w, mig, mig_w = area_inputs(a23, a24, area)
        cells = []
        p30, _ = project(p24, w, asfr, k_city, tfr_path('базовый'), mig, mig_w, range(2024, 2030))
        p36, _ = project(p24, w, asfr, k_city, tfr_path('базовый'), mig, mig_w)
        p36n, _ = project(p24, w, asfr, k_city, tfr_path('базовый'))
        for g, lo, hi in GROUPS:
            cells.append(f'{grp(p24, lo, hi)/1e3:5.1f}→{grp(p30, lo, hi)/1e3:5.1f}→{grp(p36, lo, hi)/1e3:5.1f} [{grp(p36n, lo, hi)/1e3:5.1f}]')
        print(f'{area[:24]:24}' + ''.join(f'{c:>22}' for c in cells))

    # сценарии рождаемости для города целиком
    p24, w24, mig, mig_w = area_inputs(a23, a24, 'Казань')
    print('\nКазань, 01.01.2036, тыс.: сценарий рождаемости × миграция')
    for s in ('низкий', 'базовый', 'высокий'):
        p, b = project(p24, w24, asfr, k_city, tfr_path(s), mig, mig_w)
        print(f'  {s:8} ' + '  '.join(f'{g} {grp(p, lo, hi)/1e3:5.1f}' for g, lo, hi in GROUPS)
              + f'   рождений 2030: {b[2030]/1e3:4.1f}, 2035: {b[2035]/1e3:4.1f}')
    print(f'  чистая миграция детей 0–17 за 2023 г.: {sum(mig[a] for a in range(17)):+,.0f}'.replace(',', ' '))
    return a24


def backtest_data():
    """Татарстан: прогноз от 01.01.2014 с рождаемостью 2013 (без миграции) и факт 01.01.2024."""
    ws = openpyxl.load_workbook('rt_age_2012_2022.xlsx', read_only=True, data_only=True)['2014']
    p14, w14 = {}, {}
    for r in ws.iter_rows(values_only=True):
        if r[0] is not None and str(r[0]).strip().isdigit() and isinstance(r[2], (int, float)):
            p14[int(r[0])], w14[int(r[0])] = r[2], r[4]
    asfr13 = asfr_tt('BRa1989-2014.txt', 2013)
    ws = openpyxl.load_workbook('../pv2024/Бюллетень_2024.xlsx', read_only=True, data_only=True)['2.5.4.']
    fact = {a: r[1] for r in ws.iter_rows(values_only=True) if r[0] is not None and (a := age_of(str(r[0]))) is not None}
    p_const, b_const = project(p14, w14, asfr13, 1.0, lambda y: 1.0, years=range(2014, 2024))
    return fact, p_const, b_const, asfr13


BACKTEST_GROUPS = GROUPS + [('уже рождённые к 2014 (10–17)', 10, 17)]


def backtest():
    fact, p_const, b_const, asfr13 = backtest_data()
    print('\nПроверка на прошлом: Татарстан, прогноз от 01.01.2014 против факта 01.01.2024, тыс.')
    print(f'  рождаемость 2013 по РосБРиС: {sum(asfr13.values()):.3f}; рождений в модели 2016 / 2023: {b_const[2016]/1e3:.1f} / {b_const[2023]/1e3:.1f}')
    for g, lo, hi in BACKTEST_GROUPS:
        f, m = grp(fact, lo, hi), grp(p_const, lo, hi)
        print(f'  {g:30} факт {f/1e3:6.1f}   прогноз {m/1e3:6.1f}   ошибка {100*(m/f-1):+5.1f}%')
    return fact


def tt_rates():
    """{год: (рождаемость по возрасту матери, женщины по возрасту на середину года)} Татарстана из РосБРиС, 1989–2022.
    2015–2022: коэффициенты пересчитаны по переписи 2021, женщины — нет; расхождение с официальным 2021 — в самопроверке."""
    out = {}
    for rates, pops in (('BRa1989-2014.txt', 'PopBa1989-2014.txt'), ('../rosbris/BRa2012-2023.txt', 'PopBa2015-2022.txt')):
        pop = {r['Year']: r for r in csv.DictReader(open(pops, encoding='utf-8')) if r['Reg'] == '1192' and r['Group'] == 'T'}
        for r in csv.DictReader(open(rates, encoding='utf-8')):
            y = r['Year']
            if r['Reg'] == '1192' and r['Group'] == 'T' and y in pop:
                f = {int(k[3:]): float(v) / 1e6 for k, v in r.items() if k.startswith('Bra')}
                out[int(y)] = (f, {a: float(pop[y].get(f'PopBa{a}', 0) or 0) for a in f})
    return out


def tt_history_rows():
    """[(год, рождений, СКР)] Татарстана 1989–2021: рождения = Σ возрастная рождаемость × женщины."""
    return [(y, sum(f[a] * w[a] for a in f), sum(f.values())) for y, (f, w) in sorted(tt_rates().items()) if y <= 2021]


def tt_history():
    print('\nТатарстан, история (РосБРиС): год — рождений, тыс. — СКР')
    print('  ' + '  '.join(f'{y}: {b/1e3:4.1f} / {t:.2f}' for y, b, t in tt_history_rows()))


if __name__ == '__main__':
    a24 = kazan()
    fact = backtest()
    tt_history()
    # самопроверка: районы складываются в город, разбор таблиц полный
    assert len(a24) == 8 and all(len(v) >= 70 for v in a24.values())  # районы — однолетние возрасты до 69
    kids = lambda area: sum(a24[area][a][0] for a in range(18))
    assert sum(kids(r) for r in a24 if r != 'Казань') == kids('Казань')
    hist = {y: b for y, b, _ in tt_history_rows()}
    assert abs(hist[2021] / 41_057 - 1) < 0.03, hist[2021]  # официально 2021: 41 057 (Татарстанстат, MO-23)
