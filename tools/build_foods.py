"""내려받은 식품영양성분 데이터를 앱에서 쓰는 작은 JSON으로 줄인다.

사용법: python tools/build_foods.py raw.json dish.json data/foods-db.json

항목 형식: [이름, 탄수화물, 열량(kcal), 단백질, 지방, 1인분(g), 종류]
영양성분은 100g(또는 100ml) 기준이고, 종류는 r=원재료, d=음식이다.
"""
import json
import re
import sys

raw_path, dish_path, out_path = sys.argv[1:4]

# 같은 이름이 여러 출처에 있으면 실제 분석값을 먼저 쓴다.
ORIGIN_RANK = {
    "가정식(분석 함량)": 0,
    "외식(분석함량)": 1,
    "외식(재료량 기반 산출함량)": 2,
    "외식(프랜차이즈 등 업체 제공 영양정보)": 3,
    "산업체급식(재료량 기반 산출 함량)": 4,
    "중고등학교급식(재료량 기반 산출함량)": 5,
    "초등학교급식(재료량 기반 산출 함량)": 6,
}


def num(value):
    try:
        return round(float(str(value).replace(",", "")), 1)
    except (TypeError, ValueError):
        return None


def grams(value):
    m = re.match(r"\s*([\d.]+)", str(value or ""))
    return round(float(m.group(1))) if m else None


def clean(name):
    return re.sub(r"\s+", " ", name.replace("_", " ")).strip()


items = {}


def add(key, item, rank):
    if key not in items or rank < items[key][0]:
        items[key] = (rank, item)


for row in json.load(open(raw_path, encoding="utf-8"))["rows"]:
    carbs = num(row.get("CHOCDF"))
    if carbs is None:
        continue
    name = clean(row["FOOD_NM"])
    item = [name, carbs, num(row.get("ENERC")), num(row.get("PROT")), num(row.get("FATCE")), None, "r"]
    add(("r", name), item, 0 if row.get("DATA_PROD_NM") == "분석" else 1)

for row in json.load(open(dish_path, encoding="utf-8"))["rows"]:
    carbs = num(row.get("CHOCDF"))
    if carbs is None:
        continue
    name = clean(row["FOOD_NM"])
    brand = row.get("REST_NM")
    if brand and brand != "해당없음":
        # 업체 제공값 중 탄수화물 0은 대부분 빠진 값이다.
        if carbs == 0:
            continue
        name = f"{name} ({brand})"
    item = [name, carbs, num(row.get("ENERC")), num(row.get("PROT")), num(row.get("FATCE")), grams(row.get("FOOD_SIZE")), "d"]
    add(("d", name), item, ORIGIN_RANK.get(row.get("FOOD_ORIGIN_NM"), 9))

out = {
    "source": "식품의약품안전처 식품영양성분 데이터베이스 (공공데이터포털 전국통합식품영양성분정보 표준데이터)",
    "items": sorted((item for _, item in items.values()), key=lambda i: (len(i[0]), i[0])),
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(out["items"]), "items")
