# Ученики Казани 2002–2026 (факт) и модель «ученики = k × дети, родившиеся в Казани 7–17 лет назад» → kazan_pupils.json.
# Проверка из прошлого: модель стоит в году O, знает рождения и учеников только до O, прогнозирует O+1…2026.
# Прогноз 2027–2036: рождения известны до 2024 г. (дети 2031 г. уже родились), дальше — уровень 2024 г. ±10%.
import json, sys, pathlib, statistics

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))
import os; os.chdir(ROOT.parent)
from kazan import tt_history_rows, KZN_BIRTHS  # рождения Татарстана 1989–2021 (РосБРиС); Казань 2018–2024 (Татарстанстат)

S = json.load(open(ROOT / 'kazan_series.json', encoding='utf-8'))['series']
# --- рождения Казани: 2002–2017 — сборник «Показатели городов» (коэффициент × население), 2018–2024 — Татарстанстат;
#     1989–2001 — Татарстан × доля Казани 2002–2006 (оценка)
B = {int(y): v for y, v in S['births'].items()}
B.update(KZN_BIRTHS)
rt = {y: b for y, b, _ in tt_history_rows()}
SHARE = statistics.mean(B[y] / rt[y] for y in range(2002, 2007))
for y in range(1989, 2002): B[y] = rt[y] * SHARE
B_EST = set(range(1989, 2002))
# --- ученики на начало учебного года
P, SRC = {}, {}
for y, v in S['pupils'].items(): P[int(y)], SRC[int(y)] = v * 1000, 'Росстат, «Показатели городов»'
for y, v in json.load(open(ROOT / 'bdpmo' / '8015002.json', encoding='utf-8'))['data'].items(): P[int(y)], SRC[int(y)] = v, 'Росстат, БД ПМО'
NEWS = {r['year']: r for r in json.load(open(ROOT / 'news.json', encoding='utf-8'))}
for y, r in NEWS.items(): P[y], SRC[y] = r['pupils'], 'мэрия / Минобрнауки РТ, на 1 сентября'

A0, A1 = 7, 17
def cohort(y, births):  # дети, родившиеся 7–17 лет назад (возраст на 1 сентября)
    return sum(births[b] for b in range(y - A1, y - A0 + 1))

def births_known_at(o, hi=2036):  # что знала модель в году o: рождения до o, дальше — уровень года o
    return {b: (B[b] if b <= o else B[o]) for b in range(1989, hi)}

def backtest(o, base=3):
    k = statistics.mean(P[y] / cohort(y, B) for y in range(o - base + 1, o + 1) if y in P)
    bk = births_known_at(o)
    pred = {y: round(k * cohort(y, bk)) for y in range(o + 1, 2027)}
    err = {y: round(pred[y] / P[y] - 1, 4) for y in pred if y in P}
    return k, pred, err

YEARS = [y for y in sorted(P) if y - A1 >= 1989]
ratio = {y: round(P[y] / cohort(y, B), 3) for y in YEARS}
xs, ys = [cohort(y, B) for y in YEARS], [P[y] for y in YEARS]
r = statistics.correlation(xs, ys)

O = 2015
k15, pred15, err15 = backtest(O)
naive = {y: round(P[O] / P[y] - 1, 4) for y in range(O + 1, 2027) if y in P}
roll = {o: backtest(o)[2] for o in range(2010, 2020) if o in P}  # прогноз на 7 лет из каждого года
err7 = [abs(e[o + 7]) for o, e in roll.items() if o + 7 in e]

# прогноз 2027–2036: k — диапазон 2024–2026 (0,94…0,99), середина — 2026; рождения после 2024 — уровень 2024 ±10%
K_LO, K_HI = min(ratio[y] for y in (2024, 2025, 2026)), max(ratio[y] for y in (2024, 2025, 2026))
def fut(mult): return {b: (B[b] if b <= 2024 else B[2024] * mult) for b in range(1989, 2037)}
K_NOW = ratio[2026]  # середина — коэффициент последнего года: прогноз стартует из факта 2026
fc = {y: {'lo': round(K_LO * cohort(y, fut(0.9))), 'mid': round(K_NOW * cohort(y, fut(1.0))), 'hi': round(K_HI * cohort(y, fut(1.1)))}
      for y in range(2026, 2037)}
peak = max(fc, key=lambda y: fc[y]['mid'])

out = {
    'fact': {y: {'v': round(P[y]), 'src': SRC[y], **({'url': NEWS[y]['url']} if y in NEWS else {})} for y in sorted(P)},
    'births': {y: {'v': round(B[y]), 'est': y in B_EST} for y in sorted(B)},
    'cohort': {y: cohort(y, fut(1.0)) for y in range(2006, 2037)},
    'ratio': ratio, 'r': round(r, 3),
    'backtest': {'origin': O, 'k': round(k15, 3), 'pred': pred15, 'err': err15, 'naive': naive},
    'rolling7': {'origins': sorted(roll), 'median_abs_err': round(statistics.median(err7), 4), 'max_abs_err': round(max(err7), 4)},
    'forecast': fc, 'peak': peak, 'k_range': [K_LO, K_HI], 'share_pre2002': round(SHARE, 3),
    'sources': [
        'ученики 2002–2010 — Росстат, «Регионы России. Основные социально-экономические показатели городов», выпуски 2004–2012',
        'ученики 2008–2015 — Росстат, БД показателей муниципальных образований, показатель 8015002',
        'ученики 2016–2026 — заявления мэрии Казани и Минобрнауки РТ на 1 сентября (2019 — 2020 г. минус «на 12 тыс. больше»)',
        'рождения 2002–2017 — «Показатели городов» (коэффициент рождаемости × население); 2018–2024 — Татарстанстат',
        f'рождения 1989–2001 — Татарстан (РосБРиС) × доля Казани 2002–2006 гг. ({SHARE:.1%}) — оценка',
    ],
}
json.dump(out, open(ROOT / 'kazan_pupils.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print(f'корреляция ученики ~ рождённые 7–17 лет назад, {YEARS[0]}–{YEARS[-1]}: r = {r:.3f}')
print('учеников на одного рождённого:', ratio)
print(f'\nпрогноз из {O} г. (k = {k15:.3f}, рождения после {O} неизвестны):')
for y in pred15: print(f'  {y}: модель {pred15[y]:>7,} факт {round(P[y]):>7,}  ошибка {err15[y]:+.1%}   «как в {O}» {naive[y]:+.1%}')
print(f'\nпрогноз на 7 лет из каждого года 2010–2019: медиана |ошибки| {statistics.median(err7):.1%}, макс {max(err7):.1%}')
print(f'\nпрогноз (k {K_LO}–{K_HI}): пик {peak} г. — {fc[peak]["mid"]:,}')
for y in (2026, 2028, 2030, 2033, 2036): print(f'  {y}: {fc[y]["lo"]:,}–{fc[y]["hi"]:,} (середина {fc[y]["mid"]:,})')

# самопроверка: сшивка источников и рождения
assert abs(S['pupils']['2008'] * 1000 / json.load(open(ROOT / 'bdpmo' / '8015002.json', encoding='utf-8'))['data']['2008'] - 1) < 0.01
assert abs(B[2022] / 13977 - 1) < 1e-9 and abs(round(S['births']['2022']) / 13977 - 1) < 0.01  # сборник ≈ официальный 2022
