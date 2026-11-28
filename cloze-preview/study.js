"use strict";

const $ = (id) => document.getElementById(id);
const baseDeck = window.ECG_CLOZE;
const metadata = window.ECG_IMAGE_META;
const imageSources = new Map(Object.entries(window.ECG_PRIVATE_IMAGES || {}));
const reviewKey = "ecg.cloze.records.v2";
const ruleKey = "ecg.cloze.rule.v3";
const customKey = "ecg.cloze.custom.v2";
const minute = 60_000;
const reviewMinutes = {
  intensive: [15, 120, 360, 720, 1440],
  spaced: [1440, 4320, 10080, 20160, 43200],
};
const doubleTapMs = 330;
const bindings = [];
let records = read(reviewKey, {});
let custom = read(customKey, {});
let session = null;
let activeHole = null;
let activeTrigger = null;
let pendingTap = null;
let lastGrade = null;
let editorDraft = null;
let dbPromise;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { $("storage-warning").hidden = false; return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { $("storage-warning").hidden = false; }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const node = el("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function picture(card) {
  return imageSources.get(card.id) || metadata[card.id]?.sample || "";
}

function allCards() {
  const deck = new Map(baseDeck.map((card) => [card.id, card]));
  for (const card of Object.values(custom)) deck.set(card.id, card);
  return [...deck.values()];
}

function textHoles(card) {
  return card.text.flatMap((line, row) => line.flatMap((answer, column) => column % 2
    ? [{ id: "t" + row + "-" + column, answer, cue: "" }] : []));
}

function variants(card, kind) {
  const groups = [...new Set(card.masks.map((mask) => mask.group))];
  const images = picture(card) ? groups.map((group) => ({
    card, mode: "image", group, holes: card.masks.filter((mask) => mask.group === group),
  })) : [];
  const text = textHoles(card);
  const written = text.length ? [{ card, mode: "text", group: 0, holes: text }] : [];
  if (kind === "image") return images;
  if (kind === "text") return written;
  if (card.id === "005") return [...written, ...images.filter((ticket) =>
    ticket.holes.some((hole) => records[keyFor(ticket, hole)]?.attempts))];
  return images.length ? [...images, ...written.filter((ticket) =>
    ticket.holes.some((hole) => records[keyFor(ticket, hole)]?.attempts))] : written;
}

function keyFor(ticket, hole) {
  return ticket.card.id + ":" + hole.id;
}

function scheduled(record) {
  const rule = $("review-rule").value;
  const quick = rule === "quick";
  if (quick && (record.firstCorrect || record.streak >= 3)) return Infinity;
  if (record.result === "again") return record.at;
  const intervals = reviewMinutes[rule] || reviewMinutes.spaced;
  const level = Math.max(1, Math.min(record.streak, intervals.length));
  return record.at + minute * intervals[level - 1];
}

function matchesScope(ticket, hole, scope) {
  const record = records[keyFor(ticket, hole)];
  if (scope === "all") return true;
  if (scope === "weak") return record?.result === "again";
  return !record || scheduled(record) <= Date.now();
}

function searchText(card) {
  return [card.id, card.title, card.category, card.note,
    ...card.text.flat(), ...card.masks.flatMap(({ cue, answer }) => [cue, answer])]
    .join(" ").normalize("NFKC").toLowerCase();
}

function makePool() {
  const scope = $("scope").value;
  const kind = $("kind").value;
  const category = $("category").value;
  const words = $("search").value.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tickets = allCards().filter((card) =>
    (!category || card.category === category) && words.every((word) => searchText(card).includes(word))
  ).flatMap((card) => variants(card, kind)).map((ticket) => {
    const target = ticket.holes.filter((hole) => matchesScope(ticket, hole, scope));
    const tried = target.map((hole) => records[keyFor(ticket, hole)]).filter(Boolean);
    const rank = tried.some((record) => record.result === "again") ? 0 : tried.length ? 1 : 2;
    return { ...ticket, target, rank };
  }).filter((ticket) => ticket.target.length);
  return tickets.sort((a,b) => a.rank-b.rank || a.group-b.group
    || Number(a.mode === "text" && a.card.id !== "005")-Number(b.mode === "text" && b.card.id !== "005"));
}

function updateSetup() {
  const deck = allCards();
  const cardsWithImages = deck.filter((card) => picture(card)).length;
  const selectable = makePool();
  const stats = [["教材", deck.length], ["画像あり", cardsWithImages],
    ["要復習の穴", Object.values(records).filter((record) => record.result === "again").length]];
  $("stats").replaceChildren(...stats.map(([label, count]) => {
    const cell = el("div");
    cell.append(el("strong", String(count)), label);
    return cell;
  }));
  $("pool").textContent = selectable.length
    ? "対象 " + selectable.length + "枚・" + selectable.reduce((n,t) => n+t.target.length,0) + "穴"
    : "対象なし。条件を変えてください。";
  $("start").disabled = !selectable.length;
  $("images-state").textContent = cardsWithImages + " / " + deck.length + "枚の画像を表示できます。";
}

function refreshCategories() {
  const field = $("category");
  const current = field.value;
  field.replaceChildren(new Option("全分野", ""), ...[...new Set(allCards().map((card) => card.category))]
    .map((category) => new Option(category, category)));
  if ([...field.options].some((option) => option.value === current)) field.value = current;
  updateSetup();
}

function begin(event) {
  event.preventDefault();
  const candidates = makePool();
  const limit = $("limit").value;
  const queue = limit === "all" ? candidates : candidates.slice(0, Number(limit));
  if (!queue.length) return;
  session = { queue, position: 0, scored: new Map(), totals: [] };
  $("setup").hidden = true;
  $("run").hidden = false;
  $("home").hidden = false;
  renderTicket();
}

function home() {
  cancelTap();
  session = null;
  activeHole = null;
  activeTrigger = null;
  lastGrade = null;
  $("setup").hidden = false;
  $("run").hidden = true;
  $("home").hidden = true;
  $("active-card").replaceChildren();
  updateBars();
  updateSetup();
  $("setup-title").scrollIntoView({ block: "nearest" });
}

function ticketNow() {
  return session?.queue[session.position];
}

function place(node, rect) {
  const [left, top, right, bottom] = rect;
  node.style.left = left + "%";
  node.style.top = top + "%";
  node.style.width = (right - left) + "%";
  node.style.height = (bottom - top) + "%";
}

function cancelTap() {
  if (!pendingTap) return;
  clearTimeout(pendingTap.timer);
  pendingTap = null;
}

function tapHole(hole, trigger) {
  if (activeHole?.id !== hole.id) {
    if (pendingTap) grade("good");
    activeHole = hole;
    activeTrigger = trigger;
    updateTicketState();
    return;
  }
  if (pendingTap) {
    grade("again");
    return;
  }
  pendingTap = { timer:setTimeout(() => grade("good"), doubleTapMs) };
}

function makeHole(hole, presentation, number) {
  const node = button("", (event) => tapHole(hole, event.currentTarget), "hole " + presentation);
  node.setAttribute("aria-controls", "grading");
  bindings.push({ node, hole, presentation, number });
  return node;
}

function createImage(card, className) {
  const img = el("img", "", className);
  img.src = picture(card);
  img.alt = card.title + "の教材画像";
  const size = metadata[card.id]?.size || card.size;
  if (size) [img.width, img.height] = size;
  return img;
}

function imageContent(ticket) {
  const wrapper = el("div");
  const viewport = el("figure", "", "viewport");
  const stage = el("div", "", "stage");
  const img = createImage(ticket.card);
  stage.style.setProperty("--native", Math.max(540, Math.min(img.width || 720, 1400)) + "px");
  stage.append(img);
  const numbered = el("div", "", "hole-pickers");
  numbered.setAttribute("aria-label", "穴を番号から選択");
  ticket.target.forEach((hole, index) => {
    const mask = makeHole(hole, "mask", index + 1);
    place(mask, hole.rect);
    stage.append(mask);
    numbered.append(makeHole(hole, "picker", index + 1));
  });
  img.addEventListener("error", () => {
    const written = textHoles(ticket.card);
    if (!written.length) {
      wrapper.replaceChildren(el("p", "画像を表示できません。画像を読み込み直してください。"));
      return;
    }
    const message = el("p", "画像を表示できません。", "muted");
    wrapper.replaceChildren(message, button("文章で出題する", () => {
      session.queue[session.position] = { ...ticket, mode: "text", holes: written, target: written };
      renderTicket();
    }));
  }, { once: true });
  const zoom = button("画像を拡大", () => {
    const enlarged = viewport.classList.toggle("zoom");
    zoom.textContent = enlarged ? "全体表示" : "画像を拡大";
    zoom.setAttribute("aria-pressed", String(enlarged));
    if (!enlarged) viewport.scrollLeft = 0;
  });
  zoom.setAttribute("aria-pressed", "false");
  viewport.append(stage);
  wrapper.append(zoom, viewport, numbered);
  return wrapper;
}

function writtenContent(ticket) {
  const wrapper = el("div");
  const diagram = studyDiagram(ticket.card.id);
  if (diagram) wrapper.append(diagram);
  const layout = window.ECG_LAYOUTS[ticket.card.id];

  const appendHole = (parent, id) => {
    const hole = ticket.holes.find((candidate) => candidate.id === id);
    const index = ticket.target.indexOf(hole);
    parent.append(index < 0 ? el("span", hole.answer, "inline context")
      : makeHole(hole, "inline", index + 1));
  };

  if (layout) {
    if (ticket.card.id === "005") wrapper.append(el("p", "比 ＝ V3のST低下量 ÷ ⅢのST上昇量", "ratio-caption"));
    const table = el("table", "", "recall-table");
    const header = table.createTHead().insertRow();
    layout.headers.forEach((label) => {
      const heading = el("th", label);
      heading.scope = "col";
      header.append(heading);
    });
    const body = table.createTBody();
    for (const [label, answer] of layout.rows) {
      const row = body.insertRow();
      const heading = el("th", label);
      heading.scope = "row";
      row.append(heading);
      const cell = row.insertCell();
      answer.split(/\[(\d+)\]/).forEach((part, i) => {
        if (i % 2) appendHole(cell, ticket.holes[Number(part)].id);
        else cell.append(part);
      });
    }
    wrapper.append(table);
    if (layout.foot) wrapper.append(el("p", layout.foot, "table-note"));
  } else {
    const asList = ticket.card.text.length > 1;
    const list = asList ? el("ul", "", "recall-list") : wrapper;
    for (const [row, parts] of ticket.card.text.entries()) {
      const line = el(asList ? "li" : "p", "", "card-text");
      parts.forEach((part, column) => {
        if (column % 2) appendHole(line, "t" + row + "-" + column);
        else line.append(part);
      });
      list.append(line);
    }
    if (asList) wrapper.append(list);
  }
  return wrapper;
}

function renderTicket() {
  cancelTap();
  activeHole = null;
  activeTrigger = null;
  lastGrade = null;
  bindings.length = 0;
  const area = $("active-card");
  const ticket = ticketNow();
  if (!ticket) {
    $("position").textContent = "";
    $("remaining").textContent = "";
    const goodCount = session.totals.filter((grade) => grade === "good").length;
    area.replaceChildren(el("h2", "学習完了"), el("p", "正解 " + goodCount + "穴・要復習 "
      + (session.totals.length-goodCount) + "穴"), button("出題設定へ", home, "accent next"));
    updateBars();
    return;
  }
  const { card, group, mode } = ticket;
  const heading = el("h2", card.title);
  heading.tabIndex = -1;
  const meta = el("div", "", "card-meta");
  meta.append(el("span", "教材 " + card.id + " · " + card.category),
    el("span", mode === "image" ? (group ? "画像・別の穴" : "画像") : "文章"));
  const content = mode === "image" ? imageContent(ticket) : writtenContent(ticket);
  const actions = el("div", "", "card-actions");
  const reference = button("出典画像", () => viewReferences([card]), "source-link");
  reference.hidden = !metadata[card.id] && !picture(card);
  const compare = button("比較する", () => viewReferences([card, ...allCards().filter((candidate) =>
    card.compare.includes(candidate.id))]), "");
  compare.hidden = true;
  const other = variants(card, "image").find((variant) => variant.group !== group);
  const change = button("別の穴を解く", () => {
    if (session.queue.slice(session.position + 1).some((item) =>
      item.card.id === card.id && item.mode === "image" && item.group === other.group)) {
      const index = session.queue.findIndex((item, i) => i > session.position &&
        item.card.id === card.id && item.mode === "image" && item.group === other.group);
      const [item] = session.queue.splice(index, 1);
      session.queue.splice(session.position + 1, 0, item);
    } else session.queue.splice(session.position + 1, 0, { ...other, target: other.holes });
    nextTicket();
  });
  change.hidden = true;
  meta.append(reference);
  actions.append(compare, change);
  const point = el("div", "", "point");
  point.append(el("strong", "判読のポイント"), card.note || "元画像で答えの位置を確認できます。");
  point.hidden = true;
  const next = button("次のカード", nextTicket, "accent next");
  next.disabled = true;
  area.replaceChildren(heading, meta, content, point, actions, next);
  ticket.ui = { point, compare, next, change, other };
  $("position").textContent = (session.position + 1) + " / " + session.queue.length + "枚";
  updateTicketState();
  window.scrollTo(0,0);
  heading.focus({ preventScroll:true });
}

function updateTicketState() {
  const ticket = ticketNow();
  const results = session.scored;
  bindings.forEach(({ node, hole, presentation, number }) => {
    const result = results.get(hole.id);
    const state = result || (activeHole?.id === hole.id ? "opened" : "hidden");
    node.dataset.state = state;
    node.setAttribute("aria-expanded", String(state !== "hidden"));
    node.disabled = Boolean(result);
    const title = hole.cue || "文章の穴" + number;
    if (presentation === "mask") {
      node.textContent = state === "hidden" ? String(number) : "";
      node.setAttribute("aria-label", state === "hidden" ? title : hole.answer);
    } else if (presentation === "inline") {
      node.textContent = state === "hidden" ? "空欄" : hole.answer;
      node.setAttribute("aria-label", state === "hidden" ? title : hole.answer);
    } else {
      node.textContent = String(number);
      node.setAttribute("aria-label", "穴" + number + " " + title + (result ? " 採点済み" : ""));
    }
  });
  const count = results.size;
  const complete = count === ticket.target.length;
  const pickers = $("active-card").querySelector(".hole-pickers");
  if (pickers) pickers.hidden = complete;
  $("remaining").textContent = "採点 " + count + " / " + ticket.target.length + "穴";
  ticket.ui.point.hidden = !complete;
  ticket.ui.compare.hidden = !complete || !ticket.card.compare.length;
  ticket.ui.change.hidden = !complete || !ticket.ui.other;
  ticket.ui.next.disabled = !complete;
  if (complete && session.position === session.queue.length - 1) ticket.ui.next.textContent = "結果を見る";
  updateBars();
}

function updateBars() {
  $("grading").hidden = !activeHole;
  $("undo-bar").hidden = activeHole || !lastGrade;
  document.body.classList.toggle("has-grader", Boolean(activeHole));
  if (!activeHole) return;
  $("grade-answer").textContent =
    (activeHole.cue ? activeHole.cue + "　" : "") + activeHole.answer;
  const ticket = ticketNow();
  const note = ticket.card.note;
  const leaks = ticket.target.some((hole) => hole.id !== activeHole.id && !session.scored.has(hole.id)
    && note.includes(hole.answer));
  $("grade-note").hidden = !note || leaks;
  $("grade-note").textContent = note;
  // Dock away from the last tap so it stays available for the grading gesture.
  const height = $("grading").getBoundingClientRect().height;
  const low = activeTrigger && activeTrigger.getBoundingClientRect().bottom > innerHeight - height - 8;
  $("grading").classList.toggle("dock-top", Boolean(low));
  $("undo-bar").classList.toggle("dock-top", Boolean(low));
}

function grade(result) {
  cancelTap();
  if (!activeHole) return;
  const ticket = ticketNow();
  const hole = activeHole;
  const id = keyFor(ticket, hole);
  const old = records[id];
  const attempts = (old?.attempts || 0) + 1;
  records[id] = { at: Date.now(), result, attempts,
    firstCorrect: result === "good" && (attempts === 1 || Boolean(old?.firstCorrect)),
    streak: result === "good" ? (old?.streak || 0) + 1 : 0,
  };
  lastGrade = { id, old, hole };
  session.scored.set(hole.id, result);
  activeHole = null;
  save(reviewKey, records);
  updateTicketState();
}

function undo() {
  if (!lastGrade) return;
  const { id, old, hole } = lastGrade;
  if (old) records[id] = old;
  else delete records[id];
  session.scored.delete(hole.id);
  lastGrade = null;
  activeHole = hole;
  save(reviewKey, records);
  updateTicketState();
}

function nextTicket() {
  session.totals.push(...session.scored.values());
  session.position++;
  session.scored.clear();
  renderTicket();
}

function viewReferences(cards) {
  const body = $("viewer-body");
  $("viewer-title").textContent = cards.length > 1 ? "比較する" : "元画像";
  body.replaceChildren();
  for (const card of cards) {
    const entry = el("section", "", "reference-entry");
    entry.append(el("h3", card.id + " " + card.title), el("p", card.note));
    if (picture(card)) {
      const viewport = el("div", "", "viewport");
      const img = createImage(card, "reference-image");
      img.style.setProperty("--native", Math.max(540, Math.min(img.width || 720, 1600)) + "px");
      viewport.append(img);
      const zoom = button("画像を拡大", () => {
        const expanded = img.classList.toggle("zoom");
        zoom.textContent = expanded ? "全体表示" : "画像を拡大";
        if (!expanded) viewport.scrollLeft = 0;
      });
      entry.append(zoom, viewport);
    } else {
      const status = el("p", "出典画像 " + card.id + "。画像セットか、この番号の画像を選んでください。", "muted");
      status.setAttribute("role", "status");
      const picker = el("input");
      picker.type = "file";
      picker.accept = ".json,.png,.jpg,.jpeg,image/jpeg,image/png";
      picker.multiple = true;
      const field = el("label", "出典画像を読み込む");
      field.append(picker);
      picker.addEventListener("change", async (event) => {
        status.textContent = "読み込み中…";
        picker.disabled = true;
        await importImages(event);
        if (picture(card) && $("viewer").open) viewReferences(cards);
        else {
          status.textContent = $("images-state").textContent;
          picker.disabled = false;
        }
      });
      entry.append(status, field);
    }
    body.append(entry);
  }
  if (!$("viewer").open) $("viewer").showModal();
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open("ECGstudyingImages", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Image database busy"));
  });
  return dbPromise;
}

function registerImage(id, blob) {
  const previous = imageSources.get(id);
  if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
  imageSources.set(id, URL.createObjectURL(blob));
}

async function saveImages(entries) {
  for (const { id, file } of entries) registerImage(id, file);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    for (const entry of entries) tx.objectStore("images").put(entry);
  });
}

async function restoreImages() {
  const db = await openDatabase();
  const images = await new Promise((resolve, reject) => {
    const request = db.transaction("images").objectStore("images").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const { id, file } of images) {
    if ((metadata[id] || custom[id]) && !imageSources.has(id) && file instanceof Blob) registerImage(id, file);
  }
  updateSetup();
}

async function toJpeg(file, expectedSize) {
  const address = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = address;
    await img.decode();
    const size = [img.naturalWidth, img.naturalHeight];
    if (expectedSize && !size.every((value,i) => value === expectedSize[i])) throw new Error("寸法不一致");
    if (file.type === "image/jpeg") return { file, size };
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, ...size);
    context.drawImage(img, 0, 0);
    const jpg = await new Promise((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("JPEG conversion failed"));
    }, "image/jpeg", .96));
    return { file: jpg, size };
  } finally { URL.revokeObjectURL(address); }
}

async function importImages(event) {
  const files = [...event.target.files];
  event.target.value = "";
  const entries = new Map();
  let invalid = 0;
  $("images-state").textContent = "画像を読み込み中…";
  for (const file of files) {
    try {
      if (/\.json$/i.test(file.name)) {
        const pack = JSON.parse(await file.text());
        if (pack.format !== "ecg-image-pack-v1" || !pack.images) { invalid++; continue; }
        for (const [id, data] of Object.entries(pack.images)) {
          try {
            if (!metadata[id] || typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) {
              invalid++;
              continue;
            }
            const raw = atob(data.slice("data:image/jpeg;base64,".length));
            const jpg = new Blob([Uint8Array.from(raw, (byte) => byte.charCodeAt(0))], { type:"image/jpeg" });
            const validated = await toJpeg(jpg, metadata[id].size);
            entries.set(id, { id, file:validated.file });
          } catch { invalid++; }
        }
      } else {
        const id = /^(\d{3})\.(jpe?g|png)$/i.exec(file.name)?.[1];
        if (!id || !metadata[id]) { invalid++; continue; }
        const validated = await toJpeg(file, metadata[id].size);
        entries.set(id, { id, file:validated.file });
      }
    } catch { invalid++; }
  }
  let stored = true;
  try { if (entries.size) await saveImages([...entries.values()]); }
  catch { stored = false; }
  updateSetup();
  $("images-state").textContent = entries.size
    ? entries.size + "枚を読み込みました。" + (invalid ? " 対応しない画像・データ " + invalid + "件。" : "")
      + (stored ? "" : " このブラウザでは表示中だけ保持します。")
    : "読み込める画像がありません。画像セットか、元の番号・寸法のPNGまたはJPGを選んでください。";
}

function newDraft() {
  return { id:"", title:"", category:"追加教材", note:"", compare:[], text:[], masks:[], size:null, file:null };
}

function beginEditor() {
  const select = $("edit-source");
  select.replaceChildren(new Option("新規画像", ""), ...allCards()
    .map((card) => new Option(card.id + " " + card.title, card.id)));
  select.value = "";
  loadEditor();
  $("editor").showModal();
}

function loadEditor() {
  const id = $("edit-source").value;
  if (editorDraft?.url) URL.revokeObjectURL(editorDraft.url);
  const original = allCards().find((card) => card.id === id);
  editorDraft = original
    ? { ...structuredClone(original), size:metadata[id]?.size || original.size, url:null, file:null }
    : newDraft();
  $("edit-title").value = editorDraft.title;
  $("edit-file-label").hidden = Boolean(id);
  $("edit-file").value = "";
  renderEditor();
}

async function addEditorImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const draft = editorDraft;
  try {
    const jpg = await toJpeg(file);
    if (draft !== editorDraft) return;
    if (draft.url) URL.revokeObjectURL(draft.url);
    draft.file = jpg.file;
    draft.size = jpg.size;
    draft.url = URL.createObjectURL(jpg.file);
    draft.masks = [];
    if (!$("edit-title").value) $("edit-title").value = file.name.replace(/\.[^.]+$/, "");
    renderEditor();
  } catch { $("editor-status").textContent = "画像を開けません。PNGまたはJPGを選んでください。"; }
}

function editorReady() {
  $("edit-save").disabled = !$("edit-title").value.trim() || !editorDraft.masks.length ||
    editorDraft.masks.some((mask) => !mask.answer.trim()) || !(editorDraft.id || editorDraft.file);
}

function renderEditor() {
  const draft = editorDraft;
  const address = draft.url || picture(draft);
  const stage = $("edit-stage");
  stage.hidden = !address;
  stage.replaceChildren();
  if (address && draft.size) {
    const img = el("img");
    img.src = address;
    img.alt = "穴の範囲を選ぶ画像";
    [img.width, img.height] = draft.size;
    stage.append(img);
    draft.masks.forEach((mask, i) => {
      const box = el("span", String(i + 1), "edit-box");
      place(box, mask.rect);
      stage.append(box);
    });
  }
  $("editor-status").textContent = address
    ? "画像上を指またはマウスでドラッグし、隠す範囲を囲んでください。"
    : draft.id ? "画像セットか番号付きの元画像を読み込んでから、この教材を編集できます。"
      : "追加するPNGまたはJPGを選んでください。";
  const list = $("edit-holes");
  list.replaceChildren(...draft.masks.map((mask,i) => {
    const row = el("div", "", "edit-hole-row");
    const label = el("label", "穴 " + (i+1) + " の答え");
    const input = el("input");
    input.value = mask.answer;
    input.maxLength = 180;
    input.addEventListener("input", () => { mask.answer = input.value; editorReady(); });
    label.append(input);
    const groupLabel = el("label", "出題する組");
    const group = el("select");
    group.append(new Option("基本の穴","0"), new Option("別の穴","1"));
    group.value = String(mask.group);
    group.addEventListener("change", () => { mask.group = Number(group.value); });
    groupLabel.append(group);
    const remove = button("穴を削除", () => { draft.masks.splice(i,1); renderEditor(); });
    row.append(label, remove, groupLabel);
    return row;
  }));
  editorReady();
}

const randomId = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
let drag = null;
function editorCoordinates(event) {
  const rect = $("edit-stage").getBoundingClientRect();
  const x = (event.clientX-rect.left) / rect.width * 100;
  const y = (event.clientY-rect.top) / rect.height * 100;
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v * 100)/100));
  return [clamp(x),clamp(y)];
}

function editorRect(start, end) {
  return [Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.max(start[0],end[0]),Math.max(start[1],end[1])];
}

$("edit-stage").addEventListener("pointerdown", (event) => {
  if (drag || event.button !== 0) return;
  const box = el("span", "", "edit-box");
  $("edit-stage").append(box);
  $("edit-stage").setPointerCapture(event.pointerId);
  drag = { id:event.pointerId, start:editorCoordinates(event), box };
});

$("edit-stage").addEventListener("pointermove", (event) => {
  if (drag?.id === event.pointerId) place(drag.box, editorRect(drag.start, editorCoordinates(event)));
});

$("edit-stage").addEventListener("pointerup", (event) => {
  if (drag?.id !== event.pointerId) return;
  const rect = editorRect(drag.start, editorCoordinates(event));
  drag.box.remove();
  drag = null;
  if (rect[2]-rect[0] < 1.5 || rect[3]-rect[1] < 1.5) return;
  editorDraft.masks.push({ id:"m-"+randomId(), rect, answer:"", cue:"", group:0 });
  renderEditor();
  $("edit-holes").querySelector(".edit-hole-row:last-child input")?.focus();
});

$("edit-stage").addEventListener("pointercancel", (event) => {
  if (drag?.id === event.pointerId) { drag.box.remove(); drag = null; }
});

async function storeEditor() {
  const { file, url, ...card } = editorDraft;
  card.title = $("edit-title").value.trim();
  card.id ||= "追加-" + randomId().slice(0,8);
  card.masks = card.masks.map((mask) => ({ ...mask, answer:mask.answer.trim() }));
  $("edit-save").disabled = true;
  let imageStored = true;
  try { if (file) await saveImages([{ id:card.id, file }]); }
  catch { imageStored = false; }
  custom[card.id] = card;
  save(customKey, custom);
  $("editor").close();
  refreshCategories();
  if (!imageStored) $("images-state").textContent = "画像を端末に保存できなかったため、この画面を開いている間だけ表示できます。";
}

function migrateSample() {
  const legacy = read("ecg-cloze-preview.v1", {});
  const keys = { "003":["m1","m2","m3","m4"], "009":["m1","m2"],
    "024":["t0-1","t1-1"], "049":["m1","m2","m3","m4","m5"] };
  let changed = false;
  for (const [card, holes] of Object.entries(keys)) holes.forEach((hole,i) => {
    const result = legacy[card]?.[i];
    const id = card + ":" + hole;
    if (records[id] || (result !== "good" && result !== "again")) return;
    records[id] = { at:Date.now(), result, attempts:1, streak:result === "good" ? 1 : 0, firstCorrect:result === "good" };
    changed = true;
  });
  if (changed) save(reviewKey, records);
  try { localStorage.removeItem("ecg-cloze-preview.v1"); } catch {}
}

$("setup-form").addEventListener("submit", begin);
$("home").addEventListener("click", home);
$("correct").addEventListener("click", () => grade("good"));
$("wrong").addEventListener("click", () => grade("again"));
$("close-grade").addEventListener("click", () => { cancelTap(); activeHole = null; updateTicketState(); });
$("undo").addEventListener("click", undo);
$("scope").addEventListener("change", updateSetup);
$("category").addEventListener("change", updateSetup);
$("kind").addEventListener("change", updateSetup);
$("search").addEventListener("input", updateSetup);
const savedRule = read(ruleKey, "intensive");
$("review-rule").value = ["intensive", "spaced", "quick"].includes(savedRule) ? savedRule : "intensive";
$("review-rule").addEventListener("change", () => { save(ruleKey, $("review-rule").value); updateSetup(); });
$("import-images").addEventListener("change", importImages);
$("edit").addEventListener("click", beginEditor);
$("edit-source").addEventListener("change", loadEditor);
$("edit-file").addEventListener("change", addEditorImage);
$("edit-title").addEventListener("input", editorReady);
$("edit-save").addEventListener("click", storeEditor);
$("editor").addEventListener("close", () => {
  if (editorDraft?.url) URL.revokeObjectURL(editorDraft.url);
  editorDraft = null;
});
migrateSample();
refreshCategories();
restoreImages().catch(() => {});
document.addEventListener("visibilitychange", () => { if (!document.hidden && !session) updateSetup(); });
setInterval(() => { if (!session && !document.hidden && !$("settings").open) updateSetup(); }, 30_000);
if ("serviceWorker" in navigator && location.protocol !== "file:" && !window.ECG_PRIVATE_IMAGES) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
