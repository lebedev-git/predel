# Из каждого выпуска «Показатели городов» берём файл Татарстана → docx (LibreOffice) → таблицы в tables/{выпуск}.json.
import json, pathlib, shutil, subprocess, docx

ROOT = pathlib.Path(__file__).parent
SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.exe'
conv, out = ROOT / 'conv', ROOT / 'tables'
conv.mkdir(exist_ok=True); out.mkdir(exist_ok=True)

def src(ed):  # файл Татарстана в выпуске (2016 — во вложенном архиве, распакован в 2016x)
    d = ROOT / ('2016x' if ed == '2016' else ed)
    hits = [p for p in d.rglob('*') if p.suffix.lower() in ('.doc', '.docx') and ('tatar' in p.name.lower() or 'татар' in p.name.lower())]
    return sorted(hits, key=lambda p: p.suffix.lower() != '.docx')[0] if hits else None

def to_docx(p, ed):
    dst = conv / f'{ed}.docx'
    if dst.exists(): return dst
    if p.suffix.lower() == '.docx': shutil.copy(p, dst); return dst
    tmp = conv / f'{ed}{p.suffix.lower()}'
    shutil.copy(p, tmp)  # латинское имя — LibreOffice спокойнее с путями
    subprocess.run([SOFFICE, '--headless', '--convert-to', 'docx', '--outdir', str(conv), str(tmp)], check=True, capture_output=True)
    tmp.unlink()
    return dst

def tables(path):  # таблица = заголовок (абзац перед ней) + строки ячеек
    d = docx.Document(path)
    body, res, title = d.element.body, [], ''
    for el in body.iterchildren():
        tag = el.tag.split('}')[1]
        if tag == 'p':
            t = ''.join(x.text or '' for x in el.iter() if x.tag.endswith('}t')).strip()
            if t: title = t
        elif tag == 'tbl':
            t = docx.table.Table(el, d)
            rows = [[c.text.strip() for c in r.cells] for r in t.rows]
            res.append({'title': title, 'rows': rows})
    return res

if __name__ == '__main__':
    for ed in sorted(p.name for p in ROOT.iterdir() if p.name.isdigit()):
        p = src(ed)
        if not p: print(ed, 'нет файла Татарстана'); continue
        tb = tables(to_docx(p, ed))
        json.dump(tb, open(out / f'{ed}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(ed, p.name, len(tb), 'таблиц')
