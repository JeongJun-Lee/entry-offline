import json
from openpyxl import Workbook
wb = Workbook()
ws = wb.create_sheet('sprites')
del (wb['Sheet'])

with open('./sprites.json', 'r', encoding='utf-8') as file:
    db = json.load(file)
    printable = [] 

    for idx, item in enumerate(db):
        printable.append(idx + 1)
        printable.append('')  # imageType하고 align 맞추기 위해
        printable.append(item['category']['main'])
        if 'sub' in item['category']:
            printable.append(item['category']['sub'])
        else:
            printable.append('')

        # 주의) 한국어/영어 순서가 뒤바뀐 경우가 종종 있어 엑셀에서도 순서바뀔 수 있음
        langs = [0 for _ in range(0, 5)]
        for label in item['label'].items():
            if label[0] == 'ko':
                langs[0] = label[1]
            elif label[0] == 'en':
                langs[1] = label[1]
            elif label[0] == 'uz':
                langs[2] = label[1]
            elif label[0] == 'ru':
                langs[3] = label[1]
            elif label[0] == 'kaa':
                langs[4] = label[1]
        for lang in langs:
            if lang != 0:
                printable.append(lang)
            
        ws.append(printable)
        # print(printable)    
        printable = []
        
        for item in item['pictures']:
            printable.append(item['filename'])
            if 'imageType' in item:
                printable.append(item['imageType'])
            else:
                printable.append('')
            printable.append(item['dimension']['width'])
            printable.append(item['dimension']['height'])
            
            # 주의) 한국어/영어 순서가 뒤바뀐 경우가 종종 있어 엑셀에서도 순서바뀔 수 있음
            langs = [0 for _ in range(0, 5)]
            for item in item['label'].items():
                if item[0] == 'ko':
                    langs[0] = item[1]
                elif item[0] == 'en':
                    langs[1] = item[1]
                elif item[0] == 'uz':
                    langs[2] = item[1]
                elif item[0] == 'ru':
                    langs[3] = item[1]
                elif item[0] == 'kaa':
                    langs[4] = item[1]
            for lang in langs:
                if lang != 0:
                    printable.append(lang)
            ws.append(printable)
            # print(printable)    
            printable = []

wb.save('sprites.xlsx')
wb.close()