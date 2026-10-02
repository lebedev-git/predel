# Сбор фактического контингента школ и садов с edu.tatar.ru (визитная карточка организации).
import re, html, json, time, subprocess, urllib.request, sys
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'}
def get(u):  # curl --noproxy: госсайты РТ рвут TLS-рукопожатие Python через прокси (01.10.2026)
    for _ in range(3):
        r = subprocess.run(['curl', '--noproxy', '*', '-k', '-sL', '-m', '30', '-A', UA['User-Agent'], u], capture_output=True)
        if r.stdout: return r.stdout.decode('utf-8', 'ignore')
        time.sleep(2)
    return ''
def text(t):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t)))
out = []
for district in sys.argv[1:]:
    for ty in (1, 4):
        idx = get(f'https://edu.tatar.ru/{district}/type/{ty}')
        for href, name in re.findall(r'href="(/' + district + r'/[^"]+)"[^>]*>\s*([^<]{3,200})<', idx):
            t = text(get('https://edu.tatar.ru' + href))
            m = re.search(r'У нас (?:учатся|воспитываются|обучаются)[^:]*:\s*(\d[\d\s]*)', t)
            a = re.search(r'Адрес:\s*(.{5,160}?)\s+Телефон', t)
            out.append({'district': district, 'type': 'school' if ty == 1 else 'kindergarten', 'name': html.unescape(name.strip()),
                        'url': 'https://edu.tatar.ru' + href, 'students': int(m.group(1).replace(' ', '')) if m else None,
                        'address': a.group(1) if a else None})
            print(out[-1]['name'], out[-1]['students'], flush=True)
            time.sleep(0.3)
json.dump({'fetched': time.strftime('%Y-%m-%d'), 'rows': out}, open('edu_tatar_contingent.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
