import pandas as pd, json

excel_data_df = pd.read_excel('Entry tarjimasi.xlsx', sheet_name='sprites')
excel_data_df = excel_data_df.fillna('')  # remove 'NaN' when a blank in main or sub
dict = excel_data_df.to_dict(orient='records')
# json_str = excel_data_df.to_json(orient='records', force_ascii=False)
# print(json_str)

printable = []
temp = {}
for idx, item in enumerate(dict):
    if type(item['filename']) is int:  
        if len(temp) != 0:
            printable.append(temp)
            # print(printable)
            temp = {}
        temp['_id'] = str(idx + 1)
        temp['name'] = item['ko']
        temp['created'] = ''
        temp['specials'] = []
        temp['sounds'] = []
        temp['category'] = {
            'main': item['main'], 
        }
        if item['sub']:
            temp['category']['sub'] = item['sub']
        temp['label'] = {'ko': item['ko'], 'en': item['en'], 'uz': item['uz'], 'ru': item['ru'], 'kaa': item['kaa']}
    else:  
        if not 'pictures' in temp:
            temp['pictures'] = []
        picture = {}
        picture['name'] = item['ko']
        picture['filename'] = item['filename']
        picture['imageType'] = item['imageType']
        # if picture['imageType'] == 'svg':
        #     temp['hasSvg'] = True
        picture['dimension'] = {'width': item['main'], 'height': item['sub']}
        picture['label'] = {'ko': item['ko'], 'en': item['en'], 'uz': item['uz'], 'ru': item['ru'], 'kaa': item['kaa']}
        temp['pictures'].append(picture)

if len(temp) != 0:  # Not to miss the last one
    printable.append(temp)
    # print(printable)

with open('sprites.json', 'w', encoding='utf8') as fp:
    json.dump(printable, fp, ensure_ascii=False, indent=4)
