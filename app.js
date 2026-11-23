"use strict";

const cards = window.ECG_CARDS;
const get = (id) => document.getElementById(id);
const day = 86400000;
const intervals = [1, 3, 7, 14, 30];
const progressKey = "ecgstudying.progress.v1";
const imageUrls = new Map();
const knownSources = new Set(cards.flatMap((card) => card.sources));
let currentView = "study";
let session;
let records = readProgress();

function readProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(progressKey) || "{}");
    return Object.fromEntries(cards.flatMap(({ id }) => {
      const entry = data?.[id];
      return Number.isInteger(entry?.stage) && entry.stage >= 0 && Number.isFinite(entry.due)
        ? [[id, { stage: Math.min(entry.stage, intervals.length), due: entry.due }]] : [];
    }));
  } catch {
    return {};
  }
}

function persistProgress() {
  try {
    localStorage.setItem(progressKey, JSON.stringify(records));
  } catch {
    get("source-status").textContent = "ブラウザの保存領域を利用できません。学習記録はこの画面を開いている間だけ保持します。";
    get("source-status").closest("details").open = true;
  }
}

function isDue(card) {
  const entry = records[card.id];
  return Boolean(entry && entry.due <= Date.now());
}

function isWeak(card) {
  return records[card.id]?.stage === 0;
}

function updateStats() {
  get("due-count").textContent = cards.filter(isDue).length;
  get("new-count").textContent = cards.filter((card) => !records[card.id]).length;
  get("total-count").textContent = cards.length;
  const target = selectPool().length;
  get("pool-label").textContent = target ? "対象 " + target + " 枚" : "この条件に該当するカードはありません。";
  get("start-button").disabled = !target;
}

function selectPool() {
  const category = get("study-category").value;
  const mode = get("study-mode").value;
  return cards.filter((card) => {
    if (category && card.category !== category) return false;
    if (mode === "weak") return isWeak(card);
    return mode === "all" || !records[card.id] || isDue(card);
  });
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function studyRank(card) {
  if (isWeak(card)) return 0;
  if (isDue(card)) return 1;
  if (!records[card.id]) return 2;
  return 3;
}

function showView(view) {
  currentView = view;
  for (const name of ["study", "list"]) {
    get(name + "-panel").hidden = view !== name;
    const button = get("tab-" + name);
    if (view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view === "list") renderList();
  else updateStats();
}

function startSession(poolOverride) {
  const total = get("study-size").value;
  const selected = poolOverride || selectPool();
  const sorted = shuffle(selected);
  if (get("study-mode").value !== "all") sorted.sort((a, b) => studyRank(a) - studyRank(b));
  const queue = poolOverride || (total === "all" ? sorted : sorted.slice(0, Number(total)));
  if (!queue.length) return;
  session = { queue, cursor: 0, initial: queue.length, misses: new Map(), retried: new Set(), good: new Set() };
  get("session-setup").hidden = true;
  get("session").hidden = false;
  renderQuestion();
}

function startOver() {
  session = undefined;
  get("session-setup").hidden = false;
  get("session").hidden = true;
  get("question-host").replaceChildren();
  updateStats();
  (get("start-button").disabled ? get("study-mode") : get("start-button")).focus();
}

function makeSources(card) {
  const wrap = document.createDocumentFragment();
  const imported = card.sources.filter((source) => imageUrls.has(source));
  const sourceLabel = "参照画像 " + card.sources.join("・");
  if (!imported.length) {
    wrap.append(sourceLabel);
    return wrap;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = sourceLabel;
  details.append(summary);
  for (const source of imported) {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    const link = document.createElement("a");
    img.src = link.href = imageUrls.get(source);
    img.alt = "参照画像 " + source;
    img.loading = "lazy";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = source + ".png を拡大";
    figure.append(img, link);
    details.append(figure);
  }
  wrap.append(details);
  return wrap;
}

function makeCard(card, grade, revealed = false) {
  const cardView = get("card-template").content.firstElementChild.cloneNode(true);
  const field = (name) => cardView.querySelector('[data-field="' + name + '"]');
  const solution = field("solution");
  const reveal = field("reveal");
  for (const key of ["question", "answer", "point", "category"]) field(key).textContent = card[key];
  field("number").textContent = "画像 " + card.sources.join("・");
  field("sources").append(makeSources(card));
  field("grading").hidden = !grade;
  function showAnswer(focus) {
    reveal.setAttribute("aria-expanded", "true");
    reveal.hidden = true;
    solution.hidden = false;
    if (focus) field("answer").focus({ preventScroll: true });
  }
  if (revealed) showAnswer(false);
  else reveal.addEventListener("click", () => showAnswer(true));
  if (grade) {
    for (const button of field("grading").querySelectorAll("button")) {
      button.addEventListener("click", () => grade(button.dataset.score), { once: true });
    }
  }
  return cardView;
}

function renderQuestion() {
  const progress = get("progress");
  const host = get("question-host");
  const { cursor, queue, initial } = session;
  progress.hidden = false;
  progress.max = queue.length;
  progress.value = cursor;
  if (cursor >= queue.length) {
    renderRecap(host);
    return;
  }
  const card = queue[cursor];
  get("session-position").textContent = cursor < initial
    ? "出題 " + (cursor + 1) + " / " + initial
    : "解き直し " + (cursor - initial + 1) + " / " + (queue.length - initial);
  host.replaceChildren(makeCard(card, (score) => gradeCard(card, score)));
  host.querySelector("h2").focus({ preventScroll: true });
}

function gradeCard(card, score) {
  if (score === "again") {
    records[card.id] = { stage: 0, due: Date.now() };
    session.misses.set(card.id, card);
    session.good.delete(card.id);
    if (!session.retried.has(card.id)) {
      session.retried.add(card.id);
      session.queue.push(card);
    }
  } else {
    const oldStage = records[card.id]?.stage || 0;
    const stage = Math.min(oldStage + 1, intervals.length);
    records[card.id] = { stage, due: Date.now() + intervals[stage - 1] * day };
    session.good.add(card.id);
  }
  persistProgress();
  session.cursor++;
  updateStats();
  renderQuestion();
  get("session").scrollIntoView({ block: "start" });
}

function renderRecap(host) {
  get("session-position").textContent = "今回の結果";
  const box = document.createElement("section");
  box.className = "sheet recap";
  const title = document.createElement("h2");
  title.textContent = "学習完了";
  title.tabIndex = -1;
  const counts = document.createElement("p");
  counts.textContent = session.initial + "枚を学習。覚えた " + session.good.size + "枚、要復習 " + (session.initial - session.good.size) + "枚。";
  const actions = document.createElement("div");
  actions.className = "recap-actions";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "出題設定へ";
  next.className = "primary";
  next.addEventListener("click", startOver);
  actions.append(next);
  if (session.misses.size) {
    const redo = document.createElement("button");
    redo.type = "button";
    redo.textContent = "迷ったカードを再出題";
    redo.addEventListener("click", () => startSession([...session.misses.values()]));
    actions.append(redo);
  }
  box.append(title, counts, actions);
  host.replaceChildren(box);
  title.focus({ preventScroll: true });
}

function normalize(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => "₀₁₂₃₄₅₆₇₈₉".indexOf(c));
}

function renderList() {
  const words = normalize(get("search").value.trim()).split(/\s+/).filter(Boolean);
  const category = get("list-category").value;
  const state = get("list-status").value;
  const selected = cards.filter((card) => {
    const haystack = normalize([card.title, card.category, card.question, card.answer, card.point, ...card.sources].join(" "));
    if (category && card.category !== category) return false;
    if (state === "due" && !isDue(card)) return false;
    if (state === "new" && records[card.id]) return false;
    if (state === "weak" && !isWeak(card)) return false;
    return words.every((word) => haystack.includes(word));
  });
  const list = get("card-list");
  get("list-count").textContent = selected.length + " / " + cards.length + " 枚";
  const fragment = document.createDocumentFragment();
  for (const card of selected) {
    const row = document.createElement("details");
    row.className = "list-row";
    const heading = document.createElement("summary");
    const status = document.createElement("span");
    status.textContent = !records[card.id] ? "未学習" : isWeak(card) ? "要復習" : isDue(card) ? "復習期限" : "学習済み";
    heading.append(card.title, status);
    row.append(heading, makeCard(card, null, true));
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function openImages() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open("ECGstudyingImages", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Image database upgrade blocked"));
  });
}

function rememberImage(id, file) {
  if (imageUrls.has(id)) URL.revokeObjectURL(imageUrls.get(id));
  imageUrls.set(id, URL.createObjectURL(file));
}

function updateVisibleSources() {
  if (currentView === "list") renderList();
  if (session && session.cursor < session.queue.length) {
    const sources = get("question-host").querySelector('[data-field="sources"]');
    sources.replaceChildren(makeSources(session.queue[session.cursor]));
  }
}

async function restoreImages() {
  const db = await openImages();
  try {
    const images = await new Promise((resolve, reject) => {
      const request = db.transaction("images").objectStore("images").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const { id, file } of images) {
      if (knownSources.has(id) && !imageUrls.has(id)) rememberImage(id, file);
    }
    if (imageUrls.size) {
      get("source-status").textContent = imageUrls.size + "枚の画像を読み込み済みです。";
      updateVisibleSources();
    }
  } finally {
    db.close();
  }
}

async function importImages(event) {
  const entries = new Map();
  for (const file of event.target.files) {
    const match = /^(\d+)\.png$/i.exec(file.name);
    const id = match?.[1];
    if (knownSources.has(id) && file.size && (!file.type || file.type === "image/png")) {
      entries.set(id, file);
    }
  }
  event.target.value = "";
  if (!entries.size) {
    get("source-status").textContent = "対応する画像がありません。カードに記載された番号のPNGを選んでください。";
    return;
  }
  for (const [id, file] of entries) rememberImage(id, file);
  updateVisibleSources();
  try {
    const db = await openImages();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readwrite");
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        const table = tx.objectStore("images");
        for (const [id, file] of entries) table.put({ id, file });
      });
    } finally {
      db.close();
    }
    get("source-status").textContent = imageUrls.size + "枚の画像を読み込み済みです。";
  } catch {
    get("source-status").textContent = "画像を読み込みました。端末への保存に失敗したため、この画面を開いている間だけ表示できます。";
  }
}

const categories = [...new Set(cards.map((card) => card.category))];
for (const name of ["study", "list"]) {
  get(name + "-category").replaceChildren(new Option("全分野", ""), ...categories.map((name) => new Option(name, name)));
  get("tab-" + name).addEventListener("click", () => showView(name));
}
get("session-setup").addEventListener("submit", (event) => {
  event.preventDefault();
  startSession();
});
get("end-session").addEventListener("click", startOver);
for (const id of ["study-category", "study-mode", "study-size"]) get(id).addEventListener("change", updateStats);
for (const id of ["list-category", "list-status"]) get(id).addEventListener("change", renderList);
get("search").addEventListener("input", renderList);
get("image-input").addEventListener("change", importImages);
window.addEventListener("pageshow", updateStats);
updateStats();
restoreImages().catch(() => {});
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
