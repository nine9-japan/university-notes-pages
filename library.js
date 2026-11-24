"use strict";

const byId = (id) => document.getElementById(id);
// アプリの基底URL（index.html のあるディレクトリ）。/notes/<id> へ遷移した後でも
// 相対リンクが壊れないよう、初期表示時点のURLから固定する。
const BASE = new URL("./", location.href);
const filterLabels = {
  grade: "すべての学年",
  semester: "すべての学期",
  subject: "すべての科目",
};
const filterFields = Object.keys(filterLabels);
const semesterOrder = ["前期", "後期"];
const searchInput = byId("note-search");
const catalog = byId("catalog");
const reader = byId("reader");
let notes = [];
let page = 1;

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function link(text, href, className) {
  const element = make("a", className, text);
  element.href = href;
  return element;
}

// 一覧URL（BASE基点。例: /university-notes-pages/?q=... ）
function localUrl(params) {
  const url = new URL(BASE);
  const query = params.toString();
  if (query) url.search = query;
  return url.pathname + url.search;
}

// 詳細URL（Sites版と同じ /notes/<id> パス形式。現在の検索条件を引き継ぐ）
function noteUrl(params, id) {
  const next = new URLSearchParams(params);
  next.delete("note");
  const url = new URL("notes/" + encodeURIComponent(id), BASE);
  const query = next.toString();
  if (query) url.search = query;
  return url.pathname + url.search;
}

function normalize(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ja");
}

function noteId(note) {
  return note.id || note.driveFileId;
}

function metadata(note) {
  return [note.grade, note.semester, note.classSession, note.classDate].filter(Boolean).join("　·　");
}

// 現在のURLから（一覧パラメータ, 詳細対象のノートID）を解釈する。
// 詳細は /notes/<id> パス形式と ?note=<id> の両方に対応する。
function parseLocation() {
  const params = new URLSearchParams(location.search);
  let id = params.get("note");
  const match = location.pathname.match(/\/notes\/([^/]+)\/?$/);
  if (match) {
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      id = match[1];
    }
  }
  params.delete("note");
  return { params, id };
}

function countBy(field, source) {
  const counts = new Map();
  for (const note of source) {
    const value = note[field];
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

// Sites版APIのファセットと同じ並び（文字列のコード順。前期→後期は学期の定義順を優先）
function codePointCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fillSelect(select, counts, current, order) {
  select.replaceChildren(new Option(filterLabels[select.id], ""));
  const values = [...counts.keys()];
  if (order) {
    values.sort((a, b) => {
      const rank = (v) => {
        const i = order.indexOf(v);
        return i === -1 ? order.length : i;
      };
      return rank(a) - rank(b) || codePointCompare(a, b);
    });
  } else {
    values.sort(codePointCompare);
  }
  for (const value of values) {
    select.add(new Option(value + "（" + counts.get(value) + "）", value));
  }
  if (current && !counts.has(current)) {
    // Sites版と同様、選択中の値が候補に無い場合は素の値を追加する
    select.add(new Option(current, current));
  }
  select.value = current;
}

function renderFilters(params) {
  const grade = params.get("grade") || "";
  const semester = params.get("semester") || "";
  fillSelect(byId("grade"), countBy("grade", notes), grade);
  fillSelect(byId("semester"), countBy("semester", notes), semester, semesterOrder);
  // 科目の候補は、選択中の学年・学期に合うノートだけで数える（Sites版APIのファセット仕様）
  const subjectSource = notes.filter((note) =>
    (!grade || note.grade === grade) && (!semester || note.semester === semester));
  fillSelect(byId("subject"), countBy("subject", subjectSource), params.get("subject") || "");
}

function renderCatalog(params) {
  const query = params.get("q")?.trim() || "";
  const filters = filterFields.map((field) => [field, params.get(field) || ""]);
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const labels = filters.map(([, value]) => value).filter(Boolean);
  const isFiltered = Boolean(query || labels.length);
  const matches = notes.filter((note) => filters.every(([field, value]) => !value || note[field] === value)
    && words.every((word) => note.searchText.includes(word)));
  const pageSize = isFiltered ? 30 : 5;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const requested = Number(params.get("page"));
  page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  if (page !== requested && params.has("page")) {
    params.delete("page");
    if (page > 1) params.set("page", String(page));
    history.replaceState(null, "", localUrl(params));
  }
  searchInput.value = query;
  renderFilters(params);
  byId("list-heading").textContent = isFiltered ? "検索結果" : "講義ノート一覧";
  byId("result-count").textContent = "全 " + matches.length + " 件";
  byId("active-filters").hidden = !isFiltered;
  byId("criteria").textContent = [query && "「" + query + "」", ...labels].filter(Boolean).join(" ／ ");
  byId("empty").hidden = matches.length > 0;
  byId("empty").textContent = isFiltered ? "条件に一致するノートはありません。" : "公開中のノートはありません。";
  byId("pagination").hidden = pages <= 1;
  byId("previous").disabled = page === 1;
  byId("next").disabled = page === pages;
  byId("page-count").textContent = page + " / " + pages + " ページ";
  byId("catalog-ad").hidden = matches.length === 0;

  const start = (page - 1) * pageSize;
  const rows = matches.slice(start, start + pageSize).map((note) => {
    const row = make("li");
    const entry = link(null, noteUrl(params, noteId(note)));
    entry.dataset.nav = "";
    const body = make("div", "entry-body");
    body.append(make("p", "course-name", note.subject), make("h3", null, note.title),
      make("p", "catalog-meta", metadata(note)));
    if (note.keyTerms?.length) body.append(make("p", "entry-terms", note.keyTerms.slice(0, 4).join(" ／ ")));
    const arrow = make("span", "entry-arrow", "›");
    arrow.setAttribute("aria-hidden", "true");
    entry.append(body, arrow);
    row.append(entry);
    return row;
  });
  byId("note-list").replaceChildren(...rows);
}

function driveUrl(note, action) {
  const url = action === "download"
    ? new URL("https://drive.google.com/uc?export=download&id=" + note.driveFileId)
    : new URL("https://drive.google.com/file/d/" + note.driveFileId + "/" + action);
  if (note.resourceKey) url.searchParams.set("resourcekey", note.resourceKey);
  return url.href;
}

function searchTags(note) {
  const groups = [["主要語", note.keyTerms], ["論点", note.claims], ["根拠・参照", note.evidence]];
  const details = make("details", "reader-tags");
  details.append(make("summary", null, "検索用タグ"));
  for (const [label, terms] of groups) {
    if (!terms?.length) continue;
    const section = make("section");
    const links = make("div", "catalog-tags");
    for (const term of terms) {
      const tag = link(term, localUrl(new URLSearchParams({ q: term })));
      tag.dataset.nav = "";
      links.append(tag);
    }
    section.append(make("h3", null, label), links);
    details.append(section);
  }
  return details;
}

function relatedNotes(note, params) {
  const related = make("section", "reader-related");
  related.append(make("h2", null, "関連ノート"));
  const keywords = new Set([...(note.keyTerms || []), ...(note.tags || [])].map(normalize));
  const matches = notes.filter((item) => item !== note).map((item) => ({
    item,
    score: (item.subject === note.subject ? 5 : 0)
      + [...new Set([...(item.keyTerms || []), ...(item.tags || [])].map(normalize))].filter((term) => keywords.has(term)).length,
  })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  for (const { item } of matches) {
    const entry = link(null, noteUrl(params, noteId(item)));
    entry.dataset.nav = "";
    entry.append(make("span", null, [item.subject, item.grade, item.semester].filter(Boolean).join(" · ")), item.title);
    related.append(entry);
  }
  return related;
}

function renderReader(params, id) {
  const back = link("← ノート一覧へ戻る", localUrl(params), "catalog-back");
  back.dataset.nav = "";
  reader.replaceChildren(back);
  const note = notes.find((item) => noteId(item) === id);
  if (!note) {
    reader.append(make("p", "catalog-state", "このノートは現在公開されていません。"));
    document.title = "大学講義ノート庫";
    return;
  }
  document.title = note.title + " | 大学講義ノート庫";
  const open = link("PDFを開く", driveUrl(note, "view"), "catalog-primary");
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.append(make("span", "sr-only", "（新しいタブ）"));
  const tools = make("div", "pdf-tools");
  tools.append(open, link("ダウンロード", driveUrl(note, "download"), "catalog-secondary"));
  const pdf = make("iframe", "catalog-pdf");
  pdf.title = note.title + " のPDF";
  pdf.src = driveUrl(note, "preview");
  reader.append(make("p", "course-name", note.subject), make("h1", null, note.title),
    make("p", "catalog-meta", metadata(note)), tools, pdf);
  const tags = searchTags(note);
  if (tags.childElementCount > 1) reader.append(tags);
  const related = relatedNotes(note, params);
  if (related.childElementCount > 1) reader.append(related);
}

function render() {
  const { params, id } = parseLocation();
  reader.hidden = !id;
  catalog.hidden = Boolean(id);
  if (id) {
    renderReader(params, id);
  } else {
    reader.replaceChildren();
    document.title = "大学講義ノート庫";
    renderCatalog(params);
  }
}

function change(field, value, focusResults = false) {
  const current = parseLocation().params;
  // field が null のときは全条件クリア（空のパラメータから組み直す）
  const params = field ? new URLSearchParams(current) : new URLSearchParams();
  if (field) {
    params.delete("page");
    if (value) params.set(field, value);
    else params.delete(field);
    // Sites版と同様、学期を変えたら科目の選択をリセットする
    if (field === "semester") params.delete("subject");
  }
  if (params.toString() !== current.toString()) {
    history.pushState(null, "", localUrl(params));
  }
  render();
  if (focusResults) byId("list-heading").focus();
}

// アプリ内リンク（data-nav）は再読み込みせずに遷移する（Sites版のSPA遷移に合わせる）
document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-nav]");
  if (!anchor) return;
  event.preventDefault();
  history.pushState(null, "", anchor.href);
  render();
  window.scrollTo(0, 0);
});

byId("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  change("q", searchInput.value.trim(), true);
});
for (const field of filterFields) {
  byId(field).addEventListener("change", (event) => change(field, event.currentTarget.value));
}
byId("clear-filters").addEventListener("click", () => change(null, null, true));
byId("previous").addEventListener("click", () => change("page", page > 2 ? String(page - 1) : "", true));
byId("next").addEventListener("click", () => change("page", String(page + 1), true));
byId("filter-toggle").addEventListener("click", (event) => {
  const open = byId("filter-options").classList.toggle("is-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
  byId("filter-icon").textContent = open ? "−" : "＋";
});

async function loadCatalog() {
  const loading = byId("loading");
  loading.textContent = "ノートを読み込み中…";
  try {
    const response = await fetch("./notes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Catalog load failed");
    const data = await response.json();
    notes = data.map((note) => ({
      ...note,
      searchText: normalize([note.title, note.subject, note.grade, note.semester, note.classSession, note.classDate,
        ...(note.keyTerms || []), ...(note.claims || []), ...(note.evidence || []), ...(note.tags || [])].filter(Boolean).join(" ")),
    })).sort((a, b) => (Date.parse(b.createdAt || b.classDate) || 0) - (Date.parse(a.createdAt || a.classDate) || 0));
    render();
    loading.hidden = true;
    window.addEventListener("popstate", render);
  } catch (error) {
    console.error(error);
    const retry = make("button", "catalog-link", "再試行");
    retry.addEventListener("click", loadCatalog, { once: true });
    loading.replaceChildren("ノートを読み込めませんでした。 ", retry);
  }
}

loadCatalog();
