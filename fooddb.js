// "단감 1개", "순대국 한 그릇", "우유 200ml" 같은 입력을 식품영양성분 DB에서 찾아 g으로 바꾼다.

// 1개·1공기 같은 단위의 대략적인 먹는 부분 무게(g). 앞에 있는 항목이 먼저 맞는다.
// "감자"가 "감"에 먼저 걸리지 않도록 긴 이름을 앞에 둔다.
const UNIT_WEIGHTS = [
  ["고구마", { 개: 150 }],
  ["감자", { 개: 150 }],
  ["단감", { 개: 200 }],
  ["홍시", { 개: 150 }],
  ["곶감", { 개: 40 }],
  ["감", { 개: 200 }],
  ["바나나", { 개: 120 }],
  ["사과", { 개: 230 }],
  ["배", { 개: 450 }],
  ["귤", { 개: 80 }],
  ["오렌지", { 개: 180 }],
  ["키위", { 개: 80 }],
  ["복숭아", { 개: 200 }],
  ["포도", { 송이: 300 }],
  ["옥수수", { 개: 150 }],
  ["달걀", { 개: 50 }],
  ["계란", { 개: 50 }],
  ["삼각김밥", { 개: 110 }],
  ["김밥", { 줄: 250 }],
  ["밥", { 공기: 210 }],
  ["햇반", { 개: 210 }],
  ["식빵", { 장: 35 }],
  ["베이글", { 개: 100 }],
  ["가래떡", { 개: 50 }],
  ["우유", { 잔: 200, 컵: 200, 팩: 200 }],
  ["주스", { 잔: 200, 컵: 200 }],
];

// DB에 없는 흔한 말을 DB 이름으로 바꿔 찾는다.
const ALIASES = { 밥: "쌀밥", 공기밥: "쌀밥", 흰밥: "쌀밥", 흰쌀밥: "쌀밥", 백미밥: "쌀밥", 햇반: "쌀밥", 계란: "달걀" };

const NUMBER_WORDS = { 반: 0.5, 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5 };
const SERVING_UNITS = ["인분", "그릇", "접시", "개", "회"];
const UNITS = ["g", "kg", "ml", "l", "인분", "그릇", "접시", "공기", "개", "알", "장", "조각", "잔", "컵", "팩", "송이", "줄", "회"];

let db = null;

export async function loadFoodDb() {
  if (!db) {
    db = fetch("data/foods-db.json")
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then((data) => data.items.map(([name, carbs, kcal, prot, fat, serving, kind]) => ({ name, carbs, kcal, prot, fat, serving, kind })))
      .catch((err) => {
        db = null;
        throw err;
      });
  }
  return db;
}

// "단감 1개" → { name: "단감", qty: 1, unit: "개" }
export function parseQuery(text) {
  const t = text.trim().replace(/\s+/g, " ");
  const unitPattern = UNITS.join("|");
  const m = t.match(new RegExp(`^(.*?)\\s*(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")})?\\s*(${unitPattern})?$`, "i"));
  if (!m || !m[1]) return { name: t, qty: 1, unit: null };
  const qtyRaw = m[2];
  const qty = qtyRaw === undefined ? 1 : NUMBER_WORDS[qtyRaw] ?? Number(qtyRaw);
  return { name: m[1].trim(), qty: qty || 1, unit: m[3] ? m[3].toLowerCase() : null };
}

// 이름에 맞는 단위 무게, 없으면 1인분 무게를 쓴다. 모르면 null.
export function gramsFor(item, query, { qty, unit }) {
  if (unit === "g" || unit === "ml") return qty;
  if (unit === "kg" || unit === "l") return qty * 1000;
  const text = `${query} ${item.name}`;
  if (unit) {
    const hit = UNIT_WEIGHTS.find(([key, units]) => text.includes(key) && units[unit]);
    if (hit) return qty * hit[1][unit];
  }
  if (item.serving && (!unit || SERVING_UNITS.includes(unit))) return qty * item.serving;
  if (!unit) {
    const hit = UNIT_WEIGHTS.find(([key]) => text.includes(key));
    if (hit) return qty * Object.values(hit[1])[0];
  }
  return null;
}

export function searchFoods(items, name, limit = 20) {
  const key = name.toLowerCase().trim();
  const words = (ALIASES[key] ?? key).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const item of items) {
    const n = item.name.toLowerCase();
    if (!words.every((w) => n.includes(w))) continue;
    const tokens = n.split(/[ ()+,]/);
    let score = n.length;
    if (n === words.join(" ")) score -= 1000;
    else if (n.startsWith(words[0])) score -= 300;
    else if (tokens.includes(words[0])) score -= 200;
    if (item.kind === "r" && /생것|대표|평균/.test(n)) score -= 40;
    if (/\(.+\)$/.test(n)) score += 60;
    scored.push([score, item]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, item]) => item);
}
