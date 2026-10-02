# Ученики Казани 2016–2026 (после 2015 г. Росстат по городу не публикует): официальные заявления мэрии / Минобрнауки РТ
# на 1 сентября. Скрипт скачивает каждую страницу и проверяет, что цитата с числом в тексте есть → news.json.
import json, re, ssl, subprocess, urllib.request, pathlib, html
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent
CTX = ssl._create_unverified_context()
# (учебный год с 1 сентября, учеников, url, подстрока-доказательство в тексте страницы)
NEWS = [
    (2016, 114805, 'https://kzn.ru/meriya/press-tsentr/novosti/57705_k_2019_2020_uchebnomu_godu_kolichestvo_shkolnikov_v_kazani_vyrastet_na_21_tysyachu/', '114,8'),
    (2017, 120000, 'https://kazan.aif.ru/society/details/v_kazani_den_pervoklassnika_otprazdnuyu_9_sentyabrya', '120 тысяч'),
    (2018, 128000, 'https://news.rambler.ru/education/40699710-kazanskie-shkoly-prinyali-v-1-klass-bolee-17-tysyach-detey/', '128 тысяч'),
    (2019, 136527, 'https://mon.tatarstan.ru/index.htm/news/1806823.htm', '12 тыс'),  # 2020 г. минус прирост «на 12 тыс.»
    (2020, 148527, 'https://mon.tatarstan.ru/index.htm/news/1806823.htm', '148 тыс. 527'),
    (2021, 159500, 'https://mon.tatarstan.ru/index.htm/news/2004865.htm', '160 тыс'),
    (2022, 165000, 'https://realnoevremya.ru/news/282443-kolichestvo-shkolnikov-v-kazani-vyrastet-na-8-tysyach', '165'),
    (2023, 174000, 'https://www.tatar-inform.ru/news/deficit-skol-ucitelei-i-restorany-vmesto-stolovyx-kak-kazan-vstrecaet-ucebnyi-god-5917635', '174'),
    (2024, 182000, 'https://rt.rbc.ru/tatarstan/freenews/66c2ed9f9a79473851cb4aeb', '182'),
    (2025, 181000, 'https://kazan.aif.ru/society/v-kazani-k-uchebe-pristupyat-bolee-181-tysyachi-shkolnikov', '181'),
    (2026, 183000, 'https://www.tatar-inform.ru/news/pocti-16-tys-pervoklassnikov-poidut-v-skoly-kazani-v-novom-ucebnom-godu-6038603', '183'),
]

def text(url):  # curl: госсайты РФ рвут TLS-рукопожатие Python через прокси
    r = subprocess.run(['curl', '--noproxy', '*', '-k', '-sL', '-m', '60', '-A', 'Mozilla/5.0', url], capture_output=True)
    raw = r.stdout
    if not raw: return f'ERR curl {r.returncode}'
    for enc in ('utf-8', 'cp1251'):
        try: s = raw.decode(enc); break
        except UnicodeDecodeError: continue
    s = re.sub(r'(?is)<(script|style).*?</\1>', ' ', s)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).replace('\xa0', ' ')

def check(item):
    year, val, url, proof = item
    t = text(url)
    i = t.find(proof)
    return {'year': year, 'pupils': val, 'url': url, 'ok': i >= 0, 'quote': t[max(0, i - 160):i + 120].strip() if i >= 0 else t[:120]}

if __name__ == '__main__':
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(check, NEWS))
    json.dump(res, open(ROOT / 'news.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for r in res:
        print(r['year'], r['pupils'], 'OK ' if r['ok'] else 'НЕТ', r['quote'][:260])
