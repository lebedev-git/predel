# Данные для dash.html (ключ — «ИНН:school|kg»), которых нет в charts.json: реестр организаций (адрес, ссылки) и вместимость.
# Вместимость — C:/tmp/kzn/capacity_all.json; нет файла — пустой cap, дашборд покажет «—».
# Запуск: PYTHONIOENCODING=utf-8 python dash_data.py [путь к capacity_all.json]
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REG = json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8'))
CAP_PATH = sys.argv[1] if len(sys.argv) > 1 else 'C:/tmp/kzn/capacity_all.json'
CAP = json.load(open(CAP_PATH, encoding='utf-8')) if os.path.exists(CAP_PATH) else {}

T = {'школа': 'school', 'детский сад': 'kg'}
orgs = {f"{o['ИНН']}:{T[o['тип']]}": {'addr': o['адрес'], 'n_addr': o['адресов обучения'], 'form': o['форма'],
                   'edu': o.get('edu.tatar'), 'lic': o.get('лицензия')} for o in REG}  # без ФИО и телефонов
cap = {f"{inn}:{c['type']}": {k: c.get(k) for k in ('capacity', 'lo', 'hi', 'source', 'url', 'parts')}
       for inn, c in CAP.get('orgs', {}).items() if c.get('capacity')}
out = {'orgs': orgs, 'cap': cap, 'cap_meta': CAP.get('meta')}
assert len(orgs) == len(REG), 'дубли ИНН+тип в реестре'  # один ИНН бывает и школой, и садом
json.dump(out, open(os.path.join(HERE, 'dash_data.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'организаций {len(orgs)}, с вместимостью {len(cap)} ({CAP_PATH if CAP else "файла нет"})')
