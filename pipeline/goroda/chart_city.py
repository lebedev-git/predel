# График «Ученики Казани 2002–2036»: факт, дети 7–17 лет назад, прогноз из 2015 г., прогноз до 2036 → kazan_pupils.html.
import json, pathlib

ROOT = pathlib.Path(__file__).parent
d = json.load(open(ROOT / 'kazan_pupils.json', encoding='utf-8'))
I = lambda m: {int(k): v for k, v in m.items()}
fact, coh, fc, bt = I(d['fact']), I(d['cohort']), I(d['forecast']), d['backtest']
pred = I(bt['pred']); err = I(bt['err']); naive = I(bt['naive'])

W, H, L, R, T, B = 1000, 560, 64, 150, 70, 64
X0, X1, Y1 = 2002, 2036, 220_000
x = lambda y: L + (y - X0) / (X1 - X0) * (W - L - R)
y_ = lambda v: T + (1 - v / Y1) * (H - T - B)
th = lambda v: f'{v / 1000:.0f}'.replace('.', ',')
path = lambda pts: 'M' + 'L'.join(f'{x(a):.1f},{y_(b):.1f}' for a, b in pts)

o, peak = bt['origin'], d['peak']
known = [(y, coh[y]) for y in sorted(coh) if y <= 2031]
unk = [(y, coh[y]) for y in sorted(coh) if y >= 2031]
band = path([(y, fc[y]['hi']) for y in sorted(fc)]) + 'L' + 'L'.join(f'{x(y):.1f},{y_(fc[y]["lo"]):.1f}' for y in sorted(fc, reverse=True)) + 'Z'
mid = path([(y, fc[y]['mid']) for y in sorted(fc)])
bt_line = path([(o, fact[o]['v'])] + sorted(pred.items()))
max_err = max(abs(err[y]) for y in err if y <= 2024)

svg = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Arial, sans-serif">']
for v in range(0, Y1 + 1, 50_000):
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{y_(v):.1f}" y2="{y_(v):.1f}" stroke="#e6e8eb"/>'
               f'<text x="{L - 8}" y="{y_(v) + 4:.1f}" font-size="12" fill="#6b7280" text-anchor="end">{th(v)}</text>')
for yr in range(X0, X1 + 1, 2):
    svg.append(f'<text x="{x(yr):.1f}" y="{H - B + 20}" font-size="12" fill="#6b7280" text-anchor="middle">{yr}</text>')
svg.append(f'<text x="{L - 8}" y="{T - 14}" font-size="12" fill="#6b7280" text-anchor="end">тыс.</text>')
# зона «модель смотрит вперёд из 2015»
svg.append(f'<rect x="{x(o):.1f}" y="{T}" width="{x(2026) - x(o):.1f}" height="{H - T - B}" fill="#fff4e5"/>')
svg.append(f'<rect x="{x(2026):.1f}" y="{T}" width="{x(X1) - x(2026):.1f}" height="{H - T - B}" fill="#eef4ff"/>')
svg.append(f'<text x="{x(o) + 6:.1f}" y="{T + 16}" font-size="12" fill="#b45309">проверка: прогноз сделан в {o} г.</text>')
svg.append(f'<text x="{x(2026) + 6:.1f}" y="{T + 16}" font-size="12" fill="#1d4ed8">прогноз</text>')
# дети 7–17 лет назад
svg.append(f'<path d="{path(known)}" fill="none" stroke="#9ca3af" stroke-width="2"/>')
svg.append(f'<path d="{path(unk)}" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="4 4"/>')
# прогноз до 2036
svg.append(f'<path d="{band}" fill="#93b4f5" opacity=".45"/><path d="{mid}" fill="none" stroke="#1d4ed8" stroke-width="2.5"/>')
# прогноз из 2015
svg.append(f'<path d="{bt_line}" fill="none" stroke="#ea8a1a" stroke-width="2.5" stroke-dasharray="7 5"/>')
# факт
svg.append(f'<path d="{path([(y, fact[y]["v"]) for y in sorted(fact)])}" fill="none" stroke="#111827" stroke-width="1.5" opacity=".5"/>')
for yr, f in sorted(fact.items()):
    off = 'мэрия' in f['src']
    svg.append(f'<circle cx="{x(yr):.1f}" cy="{y_(f["v"]):.1f}" r="4.5" fill="{"#fff" if off else "#111827"}" stroke="#111827" stroke-width="1.6"/>')
# подписи
def note(yr, v, text, dy=-14, anchor='middle', color='#111827', bold=False):
    svg.append(f'<text x="{x(yr):.1f}" y="{y_(v) + dy:.1f}" font-size="13" fill="{color}" text-anchor="{anchor}"{" font-weight=\"600\"" if bold else ""}>{text}</text>')
f02, f08, f26 = fact[2002]['v'], fact[2008]['v'], fact[2026]['v']
note(2002, f02, f'{th(f02)} тыс.', dy=-12, anchor='start')
note(2008, f08, f'дно: {th(f08)} тыс.', dy=22)
note(2026.3, f26, f'2026: {th(f26)} тыс.', dy=26, anchor='start', bold=True)
note(peak, fc[peak]['hi'], f'пик ≈ {peak}', dy=-10, color='#1d4ed8')
note(2036, fc[2036]['lo'], f'2036: {th(fc[2036]["lo"])}–{th(fc[2036]["hi"])} тыс.', dy=24, anchor='end', color='#1d4ed8', bold=True)
# легенда справа
lx, ly = W - R + 14, T + 30
leg = [('dot', '#111827', 'ученики, Росстат'), ('ring', '#111827', 'ученики, мэрия'), ('line', '#9ca3af', 'родились в Казани\n7–17 лет назад'),
       ('dash', '#ea8a1a', f'прогноз из {o} г.'), ('band', '#1d4ed8', 'прогноз до 2036')]
for i, (kind, c, t) in enumerate(leg):
    yy = ly + i * 40
    if kind in ('dot', 'ring'): svg.append(f'<circle cx="{lx + 8}" cy="{yy}" r="4.5" fill="{"#fff" if kind == "ring" else c}" stroke="{c}" stroke-width="1.6"/>')
    elif kind == 'band': svg.append(f'<rect x="{lx}" y="{yy - 6}" width="18" height="12" fill="#93b4f5" opacity=".6"/><line x1="{lx}" x2="{lx + 18}" y1="{yy}" y2="{yy}" stroke="{c}" stroke-width="2.5"/>')
    else: svg.append(f'<line x1="{lx}" x2="{lx + 18}" y1="{yy}" y2="{yy}" stroke="{c}" stroke-width="2.5"{" stroke-dasharray=\"5 4\"" if kind == "dash" else ""}/>')
    for j, part in enumerate(t.split('\n')):
        svg.append(f'<text x="{lx + 26}" y="{yy + 4 + j * 15}" font-size="12" fill="#374151">{part}</text>')
svg.append('</svg>')

pct = lambda v: f'{v * 100:+.1f}%'.replace('.', ',').replace('-', '−')
html = f'''<!doctype html><html lang="ru"><meta charset="utf-8"><title>Ученики Казани 2002–2036</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#111827;max-width:1000px}}h1{{font-size:22px;margin:0 0 4px}}
.sub{{color:#4b5563;margin:0 0 8px}}.kpi{{display:flex;gap:28px;margin:10px 0 0}}.kpi b{{font-size:22px;display:block}}.kpi span{{color:#6b7280;font-size:13px}}
svg{{width:100%;height:auto;display:block;margin-top:8px}}.src{{color:#6b7280;font-size:12px;margin-top:6px;line-height:1.5}}</style>
<h1>Ученики Казани: факт 2002–2026 и прогноз до 2036 г.</h1>
<p class="sub">Учеников ≈ {d["k_range"][0]:.2f}–{d["k_range"][1]:.2f} × детей, родившихся в Казани 7–17 лет назад. Рождения до 2024 г. известны — дети 2031 г. уже родились.</p>
<div class="kpi">
 <div><b>r = {d["r"]:.2f}</b><span>ученики и рождённые 7–17 лет назад, {min(I(d["ratio"]))}–2026</span></div>
 <div><b>≤ {max_err * 100:.1f}%</b><span>ошибка прогноза из {o} г. на 2016–2024</span></div>
 <div><b>{pct(naive[2026])}</b><span>ошибка прогноза «как в {o} г.» на 2026</span></div>
 <div><b>{pct(fc[2036]["mid"] / f26 - 1)}</b><span>учеников в 2036 к 2026 (середина)</span></div>
</div>
{"".join(svg)}
<div class="src">Прогноз из {o} г.: модель знает рождения и учеников только до {o} г.; 2025–2026 — {pct(err[2025])} и {pct(err[2026])}
(после 2024 г. учеников на одного рождённого стало меньше: 0,99 → 0,94). Прогноз на 7 лет из каждого года 2010–2019: медианная ошибка {d["rolling7"]["median_abs_err"] * 100:.1f}%.<br>
Источники: {"; ".join(d["sources"])}.</div></html>'''
import re
head, rest = html.split('<svg', 1); body, tail = rest.split('</svg>', 1)
fix = lambda t: re.sub(r'(?<=\d)\.(?=\d)', ',', t)
html = fix(head) + '<svg' + body + '</svg>' + fix(tail)  # десятичная запятая в тексте, не в SVG
(ROOT / 'kazan_pupils.html').write_text(html, encoding='utf-8')
print('ok', ROOT / 'kazan_pupils.html')
