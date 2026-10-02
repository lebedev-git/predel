# Выгрузка сборника Росстата «Регионы России. Основные социально-экономические показатели городов», выпуски 2004–2024.
# Нужны ряды по Казани: ученики общеобразовательных организаций, родившиеся, ввод жилья, население.
# Параллельно, с докачкой (готовые архивы не качает повторно), распаковка — tar.exe Windows (libarchive читает rar/zip).
import re, ssl, subprocess, urllib.request, pathlib, html
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent
PAGE = 'https://rosstat.gov.ru/folder/210/document/13206'
CTX = ssl._create_unverified_context()  # сертификат Минцифры не в хранилище Python
UA = {'User-Agent': 'Mozilla/5.0'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), context=CTX, timeout=120) as r:
        return r.read()

def editions():  # архив выпуска → год выпуска (по ближайшему году в тексте перед ссылкой)
    s = get(PAGE).decode('utf-8')
    out, last = {}, None
    for m in re.finditer(r'href="(/storage/mediabank/[^"]+\.(rar|zip|pdf))"', s):
        yrs = re.findall(r'(?:19|20)\d\d', re.sub(r'<[^>]+>', ' ', html.unescape(s[max(0, m.start() - 600):m.start()])))
        if m.group(2) == 'pdf' or yrs: last = int(yrs[-1]) if yrs else last
        if m.group(2) != 'pdf' and last: out[last] = 'https://rosstat.gov.ru' + m.group(1)
    return out

def fetch(item):
    year, url = item
    arc = ROOT / 'arc' / f'{year}{pathlib.Path(url).suffix}'
    if not arc.exists():
        arc.write_bytes(get(url))
    dst = ROOT / str(year)
    if not dst.exists():
        dst.mkdir()
        subprocess.run(['C:/Windows/System32/tar.exe', '-xf', str(arc), '-C', str(dst)], check=False)
    return year, arc.stat().st_size, sum(1 for p in dst.rglob('*') if p.is_file())

if __name__ == '__main__':
    (ROOT / 'arc').mkdir(exist_ok=True)
    ed = editions()
    print('выпуски:', sorted(ed))
    with ThreadPoolExecutor(6) as ex:
        for year, size, n in ex.map(fetch, sorted(ed.items())):
            print(year, f'{size / 1e6:.1f} МБ', n, 'файлов')
