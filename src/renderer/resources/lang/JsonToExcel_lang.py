import json
import re
from openpyxl import Workbook
wb = Workbook()
ws = wb.create_sheet('lang')
del (wb['Sheet'])

lang = input('Input a lang code of json: ')
if lang == 'ko':
    reg = re.compile(r'[a-zA-Z]')  # 영어단어 판별용
elif lang == 'en' or lang == 'uz':
    reg = re.compile(r'[가-힣]')  # 한글인지 판별용
else:
    reg = re.compile(r'[a-zA-Z가-힣]')  # 영어단어 또는 한글인지 판별용

with open(f'./{lang}.json', 'r', encoding='utf-8') as file:
    db = json.load(file)
    printable = []

    for item in db.items():
        if not isinstance(item[1], str):
            for item in item[1].items():
                if isinstance(item[1], str) and not reg.match(item[1]):
                    printable.append(item[0])
                    printable.append(item[1])
                    ws.append(printable)
                    # print(printable)    
                    printable = []

wb.save(f'lang({lang}).xlsx')
wb.close()