"use strict";

const byId = (id) => document.getElementById(id);
const filterLabels = {
  grade: "すべての学年",
  semester: "すべての学期",
  subject: "すべての科目",
};
const filterFields = Object.keys(filterLabels);
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

function localUrl(params) {
  return params.size ? "./?" + params : "./";
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

function catalogUrl(params, id) {
  const next = new URLSearchParams(params);
  next.delete("note");
  if (id) next.set("note", id);
  return localUrl(next);
}

function renderFilters(params) {
  for (const field of filterFields) {
    const counts = new Map();
    for (const note of notes) {
      const value = note[field];
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    const select = byId(field);
    const current = params.get(field) || "";
    if (current && !counts.has(current)) counts.set(current, 0);
    select.replaceChildren(new Option(filterLabels[field], ""));
    for (const value of [...counts.keys()].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }))) {
      select.add(new Option(value + "（" + counts.get(value) + "）", value));
    }
    select.value = current;
  }
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
  byId("filter-label").textContent = labels.length ? "絞り込み（" + labels.length + "）" : "絞り込み";
  byId("list-heading").textContent = isFiltered ? "検索結果" : "講義ノート一覧";
  byId("result-count").textContent = matches.length + "件";
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
    const entry = link(null, catalogUrl(params, noteId(note)));
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
  const groups = [["主要語", note.keyTerms], ["論点", note.claims], ["根拠・参照", note.evidence], ["タグ", note.tags]];
  const details = make("details", "reader-tags");
  details.append(make("summary", null, "検索用タグ"));
  for (const [label, terms] of groups) {
    if (!terms?.length) continue;
    const section = make("section");
    const links = make("div", "catalog-tags");
    for (const term of terms) links.append(link(term, localUrl(new URLSearchParams({ q: term }))));
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
    const entry = link(null, catalogUrl(params, noteId(item)));
    entry.append(make("span", null, [item.subject, item.grade, item.semester].filter(Boolean).join(" · ")), item.title);
    related.append(entry);
  }
  return related;
}

function renderReader(params) {
  reader.replaceChildren(link("← ノート一覧へ戻る", catalogUrl(params), "catalog-back"));
  const note = notes.find((item) => noteId(item) === params.get("note"));
  if (!note) {
    reader.append(make("h1", null, "ノートが見つかりません。"));
    document.title = "ノートが見つかりません | 大学講義ノート庫";
    return;
  }
  document.title = note.title + " | 大学講義ノート庫";
  const open = link("Driveで開く", driveUrl(note, "view"), "catalog-primary");
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
  const params = new URLSearchParams(location.search);
  const reading = params.has("note");
  reader.hidden = !reading;
  catalog.hidden = reading;
  if (reading) {
    renderReader(params);
  } else {
    reader.replaceChildren();
    document.title = "大学講義ノート庫";
    renderCatalog(params);
  }
}

function change(field, value, focusResults = false) {
  const params = new URLSearchParams(field ? location.search : "");
  params.delete("page");
  if (field) {
    if (value) params.set(field, value);
    else params.delete(field);
  }
  if (params.toString() !== location.search.slice(1)) history.pushState(null, "", localUrl(params));
  render();
  if (focusResults) byId("list-heading").focus();
}

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
