import { FOODS, DEFAULT_QUICK } from "./foods.js";

const KEYS = { settings: "cl.settings", logs: "cl.logs", quick: "cl.quick" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DEFAULT_QUOTES = [
  "35km 벽은 오늘 먹는 밥으로 넘는다",
  "훈련은 끝났다. 이제 채우기만 하면 된다",
  "일요일의 나에게 연료를 보내는 중",
  "먹는 것도 훈련이다",
];
// 기준: Featherstone Nutrition 카보로딩·레이스 영양 가이드.
// 로딩 3일은 8g/kg, 대회 아침은 체중(lb)÷2 g ≈ 1.1g/kg이고 최소 75g.
// 수분 null은 자동 계산: 평소 필요량 체중(lb)÷2 oz + 로딩 중 추가 30oz.
const DEFAULT_TARGETS = { c3: 8, c2: 8, c1: 8, c0: 1.1, w3: null, w2: null, w1: null, w0: 0.35 };
const RACE_MORNING_MIN = 75;
const SERVING = 50;
const RING = 314.16;

const autoWater = (weight) => Math.round((weight * 0.0326 + 0.89) * 10) / 10;

const $ = (id) => document.getElementById(id);

// ---------- 저장소 ----------
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("저장 공간이 부족해서 저장하지 못했어요");
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("carbload", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("photos", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function photoStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction("photos", mode).objectStore("photos"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const getPhotos = () => photoStore("readonly", (s) => s.getAll()).catch(() => []);
const putPhoto = (photo) => photoStore("readwrite", (s) => s.put(photo));
const deletePhoto = (id) => photoStore("readwrite", (s) => s.delete(id));

// ---------- 상태 ----------
let settings = load(KEYS.settings, null);
let logs = load(KEYS.logs, {});
let quick = load(KEYS.quick, DEFAULT_QUICK);
let selectedDay = null;
let photos = [];
let photoUrls = [];
let slide = 0;
let slideTimer = null;

// ---------- 날짜 ----------
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const todayKey = () => toKey(new Date());

// 로딩 3일 + 대회 당일. 인덱스 3이 대회 날이다.
const loadingDays = () => [3, 2, 1, 0].map((n) => addDays(settings.raceDate, -n));

function targetFor(dayKey) {
  const n = daysBetween(dayKey, settings.raceDate);
  const t = { ...DEFAULT_TARGETS, ...settings.targets };
  const carbs = Math.round(settings.weight * t[`c${n}`]);
  const water = t[`w${n}`];
  return {
    carbs: n === 0 ? Math.max(RACE_MORNING_MIN, carbs) : carbs,
    water: water == null ? autoWater(settings.weight) : Number(water),
  };
}

function tipsFor(dayKey) {
  const n = daysBetween(dayKey, settings.raceDate);
  const { carbs } = targetFor(dayKey);
  if (n === 0) {
    return [
      `출발 2~4시간 전에 아침으로 탄수화물 ${carbs}g. 단백질과 지방은 조금만`,
      "늦게 출발하면 약 50g 간식을 더하고, 출발 2시간 전에는 먹기를 마쳐요",
      "이온음료 300~350ml를 마시고, 출발 1시간 전에는 마시기를 마쳐요",
      "레이스 중에는 30분마다 25~30g (예상 기록 시간 × 50g)",
    ];
  }
  const tips = [
    `오늘 ${carbs}g = 50g씩 ${Math.ceil(carbs / SERVING)}번. 끼니와 간식에 고르게 나눠요`,
    "섬유질과 지방은 줄이고, 흰쌀·식빵·떡처럼 먹어본 음식으로 채워요",
    "물병을 늘 들고 다니며 물과 이온음료를 번갈아 마셔요",
  ];
  if (n === 1) tips.push("덥거나 땀이 많다면 오늘 밤 물 950ml에 나트륨 500~1500mg (과수분 섭취)");
  return tips;
}

function totalsFor(dayKey) {
  return (logs[dayKey] || []).reduce(
    (acc, e) => ({ carbs: acc.carbs + (e.carbs || 0), water: acc.water + (e.water || 0) }),
    { carbs: 0, water: 0 },
  );
}

function pickDefaultDay() {
  const days = loadingDays();
  const today = todayKey();
  if (days.includes(today)) return today;
  return today < days[0] ? days[0] : days[3];
}

// ---------- 렌더 ----------
function render() {
  if (!settings) return;
  if (!selectedDay || !loadingDays().includes(selectedDay)) selectedDay = pickDefaultDay();
  $("raceName").textContent = settings.raceName || "마라톤";
  renderSchedule();
  renderProgress();
  renderQuick();
  renderLog();
}

function renderSchedule() {
  const days = loadingDays();
  const today = todayKey();
  const untilRace = daysBetween(today, settings.raceDate);

  if (untilRace > 3) {
    $("countdown").textContent = `출발선까지 D-${untilRace}`;
    $("phase").textContent = `로딩 시작까지 ${untilRace - 3}일`;
  } else if (untilRace > 0) {
    $("countdown").textContent = `출발선까지 D-${untilRace}`;
    $("phase").innerHTML = `로딩 <b>${4 - untilRace} / 3</b>일차`;
  } else if (untilRace === 0) {
    $("countdown").textContent = "오늘은 대회 날";
    $("phase").textContent = "즐기고 오세요";
  } else {
    $("countdown").textContent = "대회가 끝났어요";
    $("phase").textContent = "완주 수고했어요";
  }

  const wrap = $("days");
  wrap.replaceChildren();
  days.forEach((key, i) => {
    const d = fromKey(key);
    const btn = document.createElement("button");
    btn.className = "day";
    if (i === 3) btn.classList.add("race");
    if (key === selectedDay) btn.classList.add("selected");
    if (totalsFor(key).carbs >= targetFor(key).carbs && targetFor(key).carbs > 0) btn.classList.add("done");
    const b = document.createElement("b");
    b.textContent = i === 3 ? `${WEEKDAYS[d.getDay()]} 🏁` : WEEKDAYS[d.getDay()];
    const small = document.createElement("small");
    small.textContent = key === today ? "오늘" : i === 3 ? "대회" : `${d.getMonth() + 1}/${d.getDate()}`;
    btn.append(b, small);
    btn.addEventListener("click", () => {
      selectedDay = key;
      render();
    });
    wrap.append(btn);
  });
}

function messageFor(pct, isRace) {
  if (isRace) {
    if (pct >= 100) return "연료 충전 완료. 이제 달리기만 하면 돼요";
    return pct === 0 ? "출발 2~4시간 전에 아침을 챙겨요" : "좋아요, 출발 전까지 조금만 더";
  }
  if (pct >= 130) return "목표 넘었어요. 이제 편하게 쉬어요";
  if (pct >= 100) return "오늘 탱크 가득. 완벽해요";
  if (pct >= 80) return "거의 다 왔어요. 간식 하나면 끝";
  if (pct >= 50) return "반 넘었어요. 한 끼만 더";
  if (pct >= 30) return "좋아요, 차곡차곡 쌓이고 있어요";
  if (pct > 0) return "시동 걸렸어요. 꾸준히 채워요";
  return "첫 끼부터 채워볼까요";
}

let lastPct = null;
function renderProgress() {
  const target = targetFor(selectedDay);
  const total = totalsFor(selectedDay);
  const pct = target.carbs ? Math.round((total.carbs / target.carbs) * 100) : 0;
  const ratio = Math.min(1, target.carbs ? total.carbs / target.carbs : 0);

  const ring = $("ring");
  ring.style.strokeDashoffset = (RING * (1 - ratio)).toFixed(1);
  ring.classList.toggle("full", pct >= 100);
  $("pct").textContent = `${pct}%`;
  $("carbText").textContent = `${Math.round(total.carbs)} / ${target.carbs}g`;
  $("message").textContent = messageFor(pct, daysBetween(selectedDay, settings.raceDate) === 0);

  const waterL = total.water / 1000;
  $("waterText").textContent =
    target.water < 1 ? `${Math.round(total.water)} / ${Math.round(target.water * 1000)}ml` : `${waterL.toFixed(1)} / ${target.water.toFixed(1)}L`;
  $("waterBar").style.width = `${Math.min(100, target.water ? (waterL / target.water) * 100 : 0)}%`;

  const left = target.carbs - total.carbs;
  $("remain").textContent = left > 0 ? `${Math.round(left)}g 남음 · 50g씩 약 ${Math.ceil(left / SERVING)}번` : "오늘 탄수화물 목표 달성";

  const tips = $("tips");
  tips.replaceChildren();
  tipsFor(selectedDay).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    tips.append(li);
  });

  if (lastPct !== null && pct !== lastPct) {
    const el = $("progress");
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  lastPct = pct;
}

function formatEntry(e) {
  const parts = [];
  if (e.carbs) parts.push(`${Math.round(e.carbs)}g`);
  if (e.water) parts.push(`${e.water >= 1000 ? (e.water / 1000).toFixed(1) + "L" : e.water + "ml"}`);
  return parts.join(" · ") || "0g";
}

function renderQuick() {
  const grid = $("quick");
  grid.replaceChildren();
  quick.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "quick-btn";
    const b = document.createElement("b");
    b.textContent = item.name;
    const small = document.createElement("small");
    small.textContent = `+${formatEntry(item)}`;
    btn.append(b, small);
    btn.addEventListener("click", () => addEntry(item));
    grid.append(btn);
  });
}

function renderLog() {
  const d = fromKey(selectedDay);
  $("logTitle").textContent = selectedDay === todayKey() ? "오늘 기록" : `${WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} 기록`;
  const entries = logs[selectedDay] || [];
  const list = $("logList");
  list.replaceChildren();
  $("logEmpty").hidden = entries.length > 0;
  [...entries].reverse().forEach((e) => {
    const li = document.createElement("li");
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = e.time;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = e.name;
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = formatEntry(e);
    const del = document.createElement("button");
    del.className = "del";
    del.setAttribute("aria-label", `${e.name} 삭제`);
    del.textContent = "✕";
    del.addEventListener("click", () => {
      if (!confirm(`'${e.name}' 기록을 지울까요?`)) return;
      logs[selectedDay] = (logs[selectedDay] || []).filter((x) => x.id !== e.id);
      save(KEYS.logs, logs);
      render();
    });
    li.append(time, name, val, del);
    list.append(li);
  });
}

// ---------- 기록 ----------
function addEntry({ name, carbs = 0, water = 0 }) {
  const now = new Date();
  const entry = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    name,
    carbs: Math.round(Number(carbs) || 0),
    water: Math.round(Number(water) || 0),
  };
  (logs[selectedDay] ||= []).push(entry);
  save(KEYS.logs, logs);
  render();
  toast(`${name} +${formatEntry(entry)}`);
}

// ---------- 히어로 ----------
function quotes() {
  const list = (settings?.quotes ?? DEFAULT_QUOTES.join("\n")).split("\n").map((q) => q.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_QUOTES;
}

async function loadPhotos() {
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photos = await getPhotos();
  photoUrls = photos.map((p) => URL.createObjectURL(p.blob));
  renderHero();
}

function renderHero() {
  const qs = quotes();
  const count = Math.max(qs.length, photoUrls.length, 1);
  slide %= count;

  const img = $("heroImg");
  if (photoUrls.length) {
    img.src = photoUrls[slide % photoUrls.length];
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  const quote = $("quote");
  quote.textContent = qs[slide % qs.length];
  quote.style.animation = "none";
  void quote.offsetWidth;
  quote.style.animation = "";

  const dots = $("dots");
  dots.replaceChildren();
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      if (i === slide) s.className = "on";
      dots.append(s);
    }
  }
}

function nextSlide() {
  slide++;
  renderHero();
  restartSlides();
}
function restartSlides() {
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    slide++;
    renderHero();
  }, 7000);
}

$("hero").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  nextSlide();
});

// ---------- 시트 ----------
function openSheet(id) {
  $(id).hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet(id) {
  $(id).hidden = true;
  document.body.style.overflow = "";
}
document.querySelectorAll(".sheet-wrap").forEach((wrap) => {
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) {
      if (wrap.id === "settingsSheet" && !settings) return;
      closeSheet(wrap.id);
    }
  });
});

// ---------- 기록 시트 ----------
$("openAdd").addEventListener("click", () => {
  $("aiNoKey").hidden = Boolean(settings?.apiKey);
  openSheet("addSheet");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === "search") renderSearch();
  });
});

function showError(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

$("mSubmit").addEventListener("click", () => {
  const name = $("mName").value.trim();
  const carbs = $("mCarbs").value;
  const water = $("mWater").value;
  if (!name) return showError("mError", "음식 이름을 입력해 주세요");
  if (carbs === "" && water === "") return showError("mError", "탄수화물이나 수분 중 하나는 입력해 주세요");
  if (Number(carbs) < 0 || Number(water) < 0) return showError("mError", "0 이상의 숫자를 입력해 주세요");
  showError("mError", "");
  const item = { name, carbs: Number(carbs) || 0, water: Number(water) || 0 };
  if ($("mSave").checked) {
    quick = [...quick, item];
    save(KEYS.quick, quick);
  }
  addEntry(item);
  $("mName").value = $("mCarbs").value = $("mWater").value = "";
  $("mSave").checked = false;
  closeSheet("addSheet");
});
["mName", "mCarbs", "mWater"].forEach((id) => $(id).addEventListener("input", () => showError("mError", "")));

function renderSearch() {
  const q = $("sQuery").value.trim().toLowerCase();
  const seen = new Set();
  const all = [...quick, ...FOODS].filter((f) => !seen.has(f.name) && seen.add(f.name));
  const list = $("sList");
  list.replaceChildren();
  all
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .forEach((f) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.name;
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = formatEntry(f);
      const mult = document.createElement("span");
      mult.className = "mult";
      [0.5, 1, 1.5].forEach((m) => {
        const b = document.createElement("button");
        b.textContent = `×${m}`;
        b.addEventListener("click", () => {
          addEntry({ name: m === 1 ? f.name : `${f.name} ×${m}`, carbs: (f.carbs || 0) * m, water: (f.water || 0) * m });
          closeSheet("addSheet");
        });
        mult.append(b);
      });
      li.append(name, val, mult);
      list.append(li);
    });
}
$("sQuery").addEventListener("input", renderSearch);

// ---------- 사진·설명 추정 ----------
let aiImage = null;
let aiItems = [];

$("aiPhoto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { imageToBase64 } = await import("./ai.js");
  aiImage = await imageToBase64(file);
  $("aiPreview").src = `data:image/jpeg;base64,${aiImage}`;
  $("aiPreview").hidden = false;
  $("aiPhotoLabel").textContent = "다른 사진 고르기";
  showError("aiError", "");
});

$("aiRun").addEventListener("click", async () => {
  if (!settings?.apiKey) return showError("aiError", "설정에서 Claude API 키를 먼저 넣어 주세요");
  const description = $("aiDesc").value.trim();
  if (!aiImage && !description) return showError("aiError", "사진을 고르거나 먹은 음식을 설명해 주세요");
  showError("aiError", "");
  const btn = $("aiRun");
  btn.disabled = true;
  btn.textContent = "추정 중…";
  try {
    const { estimateCarbs } = await import("./ai.js");
    const result = await estimateCarbs({ apiKey: settings.apiKey, imageBase64: aiImage, description });
    aiItems = result.items.map((i) => ({ name: i.name, carbs: Math.round(i.carbs_g) }));
    $("aiNote").textContent = result.note;
    renderAiItems();
    $("aiResult").hidden = false;
  } catch (err) {
    showError("aiError", err.message || "추정에 실패했어요. 직접 입력을 이용해 주세요.");
  } finally {
    btn.disabled = false;
    btn.textContent = "탄수화물 추정하기";
  }
});

function renderAiItems() {
  const list = $("aiItems");
  list.replaceChildren();
  aiItems.forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.name;
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.className = "inline-num";
    input.value = item.carbs;
    input.addEventListener("input", () => {
      item.carbs = Number(input.value) || 0;
      $("aiTotal").value = aiItems.reduce((s, i) => s + i.carbs, 0);
    });
    li.append(name, input, document.createTextNode("g"));
    list.append(li);
  });
  $("aiTotal").value = aiItems.reduce((s, i) => s + i.carbs, 0);
}

$("aiSave").addEventListener("click", () => {
  const total = Number($("aiTotal").value);
  if (!(total >= 0)) return showError("aiError", "합계를 숫자로 입력해 주세요");
  const name = aiItems.map((i) => i.name).join(", ") || $("aiDesc").value.trim() || "사진 기록";
  addEntry({ name, carbs: total });
  aiImage = null;
  aiItems = [];
  $("aiPreview").hidden = true;
  $("aiResult").hidden = true;
  $("aiDesc").value = "";
  $("aiPhoto").value = "";
  $("aiPhotoLabel").textContent = "사진 찍기 또는 고르기";
  closeSheet("addSheet");
});

// ---------- 설정 ----------
const form = $("settingsForm");

function fillSettings() {
  const s = settings || {};
  const t = { ...DEFAULT_TARGETS, ...s.targets };
  form.raceName.value = s.raceName || "";
  form.raceDate.value = s.raceDate || "";
  form.weight.value = s.weight || "";
  Object.keys(DEFAULT_TARGETS).forEach((k) => (form[k].value = t[k] ?? ""));
  updateWaterPlaceholders();
  form.quotes.value = s.quotes ?? DEFAULT_QUOTES.join("\n");
  form.apiKey.value = s.apiKey || "";
  document.querySelector("#settingsSheet [data-close]").hidden = !settings;
  renderThumbs();
  renderQuickManage();
}

function updateWaterPlaceholders() {
  const weight = Number(form.weight.value);
  ["w3", "w2", "w1"].forEach((k) => (form[k].placeholder = weight ? `자동 ${autoWater(weight)}` : "자동"));
}
form.weight.addEventListener("input", updateWaterPlaceholders);

function renderThumbs() {
  const wrap = $("photoThumbs");
  wrap.replaceChildren();
  photos.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    const img = document.createElement("img");
    img.src = photoUrls[i];
    img.alt = "";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "✕";
    del.setAttribute("aria-label", "사진 삭제");
    del.addEventListener("click", async () => {
      await deletePhoto(p.id);
      await loadPhotos();
      renderThumbs();
    });
    div.append(img, del);
    wrap.append(div);
  });
}

function renderQuickManage() {
  const list = $("quickManage");
  list.replaceChildren();
  quick.forEach((item, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = formatEntry(item);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn small";
    del.textContent = "빼기";
    del.addEventListener("click", () => {
      quick = quick.filter((_, j) => j !== i);
      save(KEYS.quick, quick);
      renderQuickManage();
      renderQuick();
    });
    li.append(name, val, del);
    list.append(li);
  });
  if (!quick.length) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.textContent = "직접 입력에서 '빠른 추가에도 저장'을 체크하면 여기에 추가돼요.";
    list.append(li);
  }
}

function updateQuick(next) {
  quick = next;
  save(KEYS.quick, quick);
  renderQuickManage();
  renderQuick();
}

$("qAdd").addEventListener("click", () => {
  const name = $("qName").value.trim();
  const carbs = $("qCarbs").value;
  const water = $("qWater").value;
  if (!name) return showError("qError", "음식 이름을 입력해 주세요");
  if (carbs === "" && water === "") return showError("qError", "탄수화물이나 수분 중 하나는 입력해 주세요");
  if (Number(carbs) < 0 || Number(water) < 0) return showError("qError", "0 이상의 숫자를 입력해 주세요");
  showError("qError", "");
  updateQuick([...quick, { name, carbs: Number(carbs) || 0, water: Number(water) || 0 }]);
  $("qName").value = $("qCarbs").value = $("qWater").value = "";
  toast(`빠른 추가에 넣었어요: ${name}`);
});
["qName", "qCarbs", "qWater"].forEach((id) => $(id).addEventListener("input", () => showError("qError", "")));

// 기본 항목을 원래 순서대로 앞에 두고, 직접 넣은 항목은 뒤에 그대로 둔다.
$("qRestore").addEventListener("click", () => {
  const defaultNames = new Set(DEFAULT_QUICK.map((d) => d.name));
  const missing = DEFAULT_QUICK.filter((d) => !quick.some((q) => q.name === d.name));
  if (!missing.length) return toast("기본 항목이 모두 들어 있어요");
  updateQuick([...DEFAULT_QUICK, ...quick.filter((q) => !defaultNames.has(q.name))]);
  toast(`되돌렸어요: ${missing.map((d) => d.name).join(", ")}`);
});

async function resizeToBlob(file, max = 1280) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

$("photoInput").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  for (const file of files) {
    try {
      await putPhoto({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, blob: await resizeToBlob(file) });
    } catch {
      toast("사진 하나를 저장하지 못했어요");
    }
  }
  e.target.value = "";
  await loadPhotos();
  renderThumbs();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const weight = Number(form.weight.value);
  if (!form.raceDate.value) return showError("setError", "대회 날짜를 입력해 주세요");
  if (!(weight >= 30 && weight <= 150)) return showError("setError", "체중을 30~150kg 사이로 입력해 주세요");
  showError("setError", "");
  const targets = {};
  Object.keys(DEFAULT_TARGETS).forEach((k) => (targets[k] = form[k].value === "" ? null : Number(form[k].value)));
  settings = {
    raceName: form.raceName.value.trim(),
    raceDate: form.raceDate.value,
    weight,
    targets,
    quotes: form.quotes.value,
    apiKey: form.apiKey.value.trim(),
  };
  save(KEYS.settings, settings);
  selectedDay = null;
  closeSheet("settingsSheet");
  render();
  renderHero();
  toast("저장했어요");
});
form.addEventListener("input", () => showError("setError", ""));

$("resetAll").addEventListener("click", () => {
  if (!confirm("모든 날의 먹은 기록을 지울까요? 설정과 사진은 그대로 남아요.")) return;
  logs = {};
  save(KEYS.logs, logs);
  render();
  toast("기록을 지웠어요");
});

$("openSettings").addEventListener("click", () => {
  fillSettings();
  openSheet("settingsSheet");
});

// ---------- 기타 ----------
let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

if (/KAKAOTALK/i.test(navigator.userAgent)) {
  $("inapp").hidden = false;
  $("openExternal").addEventListener("click", () => {
    location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
  });
}

// 자정을 넘겨 다시 열었을 때 오늘 날짜로 맞춘다.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && settings) {
    selectedDay = null;
    render();
  }
});

renderHero();
restartSlides();
loadPhotos();
if (settings) {
  render();
} else {
  fillSettings();
  openSheet("settingsSheet");
}
