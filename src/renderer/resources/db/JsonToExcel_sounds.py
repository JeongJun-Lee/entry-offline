import json
from openpyxl import Workbook
wb = Workbook()
ws = wb.create_sheet('sounds')
del (wb['Sheet'])

with open('./sounds.json', 'r', encoding='utf-8') as file:
    db = json.load(file)
    printable = []

    for item in db:
        printable.append(item['filename'])
        printable.append(item['ext'])
        printable.append(item['duration'])
        printable.append(item['category']['main'])
        printable.append(item['category']['sub'])
        
        for item in item['label'].items():
            if item[0] != 'vn' and item[0] != 'jp':
                printable.append(item[1])
        ws.append(printable)
        print(printable)    
        printable = []

wb.save('sounds.xlsx')
wb.close()