import pandas as pd
import json

# Get the language code from user input
lang = input('Input a lang code of json: ')

# Read Excel data into a DataFrame
excel_data_df = pd.read_excel('Entry tarjimasi.xlsx', sheet_name='Blocks')

# Remove 'Type' column and fill NaN values with empty strings
excel_data_df = excel_data_df.drop(columns=['Type'])
excel_data_df = excel_data_df.fillna('')
# Convert DataFrame to dictionary records
excel_dict = excel_data_df.to_dict(orient='records')

# Initialize temporary JSON list for the json dump
printable = []
temp = {}
# Open the original JSON file
with open(f'./{lang}.json', 'r', encoding='utf-8') as file:
    # Make origin_db editable
    origin_db = json.load(file)
    for item in origin_db.items():
         temp[item[0]] = item[1]
    printable.append(temp)

    # Iterate over items in the Excel data
    for item in excel_dict:
        result = None
        group = item['Group']
        if not group: 
            print('Group field is missing. Try again after filling it!!')
            break
        key = item['Key']
        value = item[lang]

        next_iternate = False
        for grp in printable[0].items():
            if next_iternate: # Need not to the next since the value have applied
                next_iternate = False 
                break
            if grp[0] == group:
                next_iternate = True
                for nested_item in grp[1].items():
                    if nested_item[0] == key and nested_item[1] != value:
                        printable[0][group][key] = value
                        print(f'Bingo! {key}: {value}')
            

# Write the updated JSON data back to the file
with open(f'./{lang}.json', 'w', encoding='utf-8') as fp:
    json.dump(printable[0], fp, ensure_ascii=False, indent=2)
