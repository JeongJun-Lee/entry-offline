import pandas, json

excel_data_df = pandas.read_excel('sounds.xlsx', sheet_name='sounds')
excel_data_df = excel_data_df.fillna('')  # remove 'NaN' when a blank in main or sub
dict = excel_data_df.to_dict(orient='records')
# json_str = excel_data_df.to_json(orient='records', force_ascii=False)
# print(json_str)

printable = []
for idx, item in enumerate(dict):
    # print(item)
    temp = {}
    temp['_id'] = str(idx + 1)
    temp['filename'] = item['filename']
    temp['ext'] = item['ext']
    temp['duration'] = item['duration']
    temp['category'] = {'main': item['main'], 'sub': item['sub']}
    temp['name'] = item['ko']
    temp['label'] = {'ko': item['ko'], 'en': item['en'], 'uz': item['uz'], 'ru': item['ru']}
    temp['created'] = ''
    temp['specials'] = []
    printable.append(temp)
# print(printable)

with open('sounds.json', 'w') as fp:
    json.dump(printable, fp, ensure_ascii=False, indent=4)
