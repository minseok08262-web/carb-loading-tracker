"""공공데이터포털 '전국통합식품영양성분정보' 표준데이터를 JSON으로 내려받는다.

사용법: python tools/fetch_food.py 15100065 raw.json   # 원재료성식품
        python tools/fetch_food.py 15100070 dish.json  # 음식
"""
import json
import sys
import urllib.parse
import urllib.request

pk, out = sys.argv[1], sys.argv[2]
BASE = "https://www.data.go.kr"
HEADERS = {"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/data/{pk}/standard.do"}


def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


header = get(f"{BASE}/download/columList.json?pk={pk}&ext=JSON")
table = header["tableVO"]
total = header["totalCount"]

rows = []
page = 1
while len(rows) < total:
    params = [("colNmList", c) for c in table["colNmList"]] + [
        ("totalCount", total), ("svcTableNm", table["svcTableNm"]), ("perPage", 10000), ("page", page)]
    batch = get(f"{BASE}/download/standard.json?" + urllib.parse.urlencode(params))
    if not batch:
        break
    rows.extend(batch)
    page += 1

with open(out, "w", encoding="utf-8") as f:
    json.dump({"rows": rows}, f, ensure_ascii=False)
print(pk, len(rows), "rows")
