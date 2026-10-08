/* Renders issues/*.json. A new day only needs a JSON file and an index update. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const main = document.getElementById("main");
const notionLink = document.getElementById("notion-link");
const modalRoot = document.getElementById("modal-root");
const modalDialog = document.getElementById("modal-dialog");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");

const catalog = new Map();
let modalId = "";
let opener = null;
let lockedScroll = 0;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), document.baseURI);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function hashId() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function requestedDate() {
  const query = new URLSearchParams(location.search).get("d");
  if (query) return query;
  const hash = hashId();
  if (hash.startsWith("d=")) return hash.slice(2);
  if (DATE_RE.test(hash)) return hash;
  return "";
}

async function fetchJSON(path) {
  const response = await fetch(new URL(path, document.baseURI), { cache: "no-cache" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function setMeta(name, content, attr = "name") {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function applyMeta(issue, coverUrl) {
  const title = issue.title || "通信行业日报";
  const description = [issue.theme, issue.highlights?.[0]?.text].filter(Boolean).join(" ");
  document.title = title;
  setMeta("description", description || "通信行业日报");
  setMeta("og:title", title, "property");
  setMeta("og:description", description || title, "property");
  setMeta("og:url", location.href, "property");
  if (coverUrl) setMeta("og:image", coverUrl, "property");
}

function renderLinks(links) {
  if (!Array.isArray(links)) return "";
  const anchors = links
    .map((link) => {
      if (!link || typeof link !== "object") return "";
      const href = safeUrl(link.url);
      if (!href) return "";
      const label = esc(link.label || href);
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .filter(Boolean);
  if (!anchors.length) return "";
  return `<p class="links">${anchors.join("")}</p>`;
}

function paragraphs(text) {
  const parts = String(text ?? "").split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  return parts.map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function chipHtml(emoji, label) {
  const text = [emoji, label].filter(Boolean).join(" ");
  return `<span class="chip">${esc(text)}</span>`;
}

function registerCard(item, meta) {
  catalog.set(meta.id, {
    id: meta.id,
    title: item.title || "",
    date: item.date || "",
    summary: item.summary || "",
    detail: typeof item.detail === "string" ? item.detail : "",
    titleEn: meta.paper ? (item.title_en || "") : "",
    authors: item.authors || "",
    links: Array.isArray(item.links) ? item.links : [],
    emoji: meta.emoji || "",
    category: meta.category || "",
  });
  return `<button type="button" class="story-card" id="${esc(meta.id)}" data-item="${esc(meta.id)}" aria-haspopup="dialog">
    <span class="card-top">${chipHtml(meta.emoji, meta.category)}<span class="card-date">${esc(item.date || "")}</span></span>
    <span class="card-title">${esc(item.title || "")}</span>
    <span class="card-summary">${esc(item.summary || "")}</span>
    <span class="card-more"><span>详情</span><span aria-hidden="true">→</span></span>
  </button>`;
}

function issueMeta(issue) {
  return [issue.date, issue.weekday].filter(Boolean).map(esc).join(" · ");
}

function renderSwitch(older, newer) {
  if (!older && !newer) return "";
  const link = (issue, kind, label) =>
    `<a class="pager-${kind}" href="?d=${esc(issue.date)}"><span class="pager-k">${label}</span><span class="pager-d">${issueMeta(issue)}</span></a>`;
  const oldLink = older ? link(older, "old", "‹ 更早") : "<span></span>";
  const newLink = newer ? link(newer, "next", "更新 ›") : "<span></span>";
  return `<nav class="pager" aria-label="前后期">${oldLink}${newLink}</nav>`;
}

function renderArchive(issues, current) {
  const items = issues.map((issue) => {
    const currentAttr = issue.date === current ? ' aria-current="page"' : "";
    const time = DATE_RE.test(issue.date || "")
      ? `<time datetime="${esc(issue.date)}">${esc(issue.date)}</time>`
      : esc(issue.date || "");
    return `<li><a class="arch-card" href="?d=${esc(issue.date)}"${currentAttr}>
      <span class="arch-meta">${time}<span>${esc(issue.weekday || "")}</span></span>
      <span class="arch-theme">${esc(issue.theme || issue.title || "")}</span>
    </a></li>`;
  }).join("");
  return `<section class="archive" id="archive">
    <h2>往期</h2>
    <ul class="archive-grid">${items}</ul>
  </section>`;
}

function renderHero(issue) {
  const cover = issue.cover && typeof issue.cover === "object" ? issue.cover : {};
  const coverUrl = safeUrl(cover.url);
  const image = coverUrl
    ? `<img class="hero-img" alt="" src="${esc(coverUrl)}" width="3840" height="2160" decoding="async" fetchpriority="high">`
    : "";
  const dateText = DATE_RE.test(issue.date || "")
    ? `<time datetime="${esc(issue.date)}">${esc(issue.date)}</time>`
    : esc(issue.date || "");
  const weekday = issue.weekday ? ` · ${esc(issue.weekday)}` : "";
  let credit = "";
  if (cover.credit || cover.source) {
    const source = safeUrl(cover.source);
    const label = esc(cover.credit || "来源");
    const inner = source
      ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
    credit = `<p class="credit">封面 ${inner}</p>`;
  }
  return `<header class="hero">
    ${image}
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="hero-copy">
      <p class="hero-date">${dateText}${weekday}</p>
      <h1 class="hero-theme">${esc(issue.theme || "")}</h1>
      <p class="hero-title">${esc(issue.title || "")}</p>
      ${credit}
    </div>
  </header>`;
}

function renderHighlights(highlights) {
  if (!highlights.length) return "";
  const items = highlights.map((item) => {
    if (!item || typeof item !== "object") return "";
    return `<article class="hl-card"><span class="hl-label">${esc(item.label || "")}</span><p>${esc(item.text || "")}</p></article>`;
  }).join("");
  return `<section class="band" aria-labelledby="hl-title">
    <h2 id="hl-title" class="band-title">今日要点</h2>
    <div class="hl-grid">${items}</div>
  </section>`;
}

function renderIssue(issue, issues) {
  if (modalId) closeModal();
  catalog.clear();
  const list = issues.filter((item) => item && DATE_RE.test(item.date || ""));
  const index = list.findIndex((item) => item.date === issue.date);
  const newer = index > 0 ? list[index - 1] : null;
  const older = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
  const research = Array.isArray(issue.research) ? issue.research : [];
  const industry = Array.isArray(issue.industry) ? issue.industry : [];
  const highlights = Array.isArray(issue.highlights) ? issue.highlights : [];
  const switcher = renderSwitch(older, newer);

  const papers = research.length
    ? `<section class="part" aria-labelledby="part-research">
        <header class="sec-head">
          <h2 id="part-research">🛩️ 无人机通信科研</h2>
          <span class="sec-count">${research.length} 篇</span>
        </header>
        <div class="card-grid">${research.map((item, i) => registerCard(item, {
          id: `item-r-${i}`,
          paper: true,
          emoji: "🛩️",
          category: "科研",
        })).join("")}</div>
      </section>`
    : "";

  const groups = industry.map((group, gi) => {
    if (!group || typeof group !== "object") return "";
    const items = Array.isArray(group.items) ? group.items : [];
    const emoji = group.emoji || "";
    const section = group.section || "";
    return `<section class="sub">
      <h3 class="group-head">${esc([emoji, section].filter(Boolean).join(" "))}</h3>
      <div class="card-grid">${items.map((item, ii) => registerCard(item, {
        id: `item-i-${gi}-${ii}`,
        paper: false,
        emoji,
        category: section,
      })).join("")}</div>
    </section>`;
  }).join("");

  const newsCount = industry.reduce((sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0), 0);
  const news = groups
    ? `<section class="part" aria-labelledby="part-industry">
        <header class="sec-head">
          <h2 id="part-industry">📰 行业动态</h2>
          <span class="sec-count">${newsCount} 条</span>
        </header>
        ${groups}
      </section>`
    : "";

  const coverUrl = safeUrl(issue.cover && issue.cover.url);
  applyMeta(issue, coverUrl);
  const notion = safeUrl(issue.notion_url);
  if (notion) {
    notionLink.href = notion;
    notionLink.hidden = false;
  } else {
    notionLink.hidden = true;
    notionLink.removeAttribute("href");
  }

  main.innerHTML = `${renderHero(issue)}
    <div class="page shell">
      ${renderHighlights(highlights)}
      ${switcher}
      ${papers}
      ${news}
      ${switcher}
      ${renderArchive(list, issue.date)}
      <p class="colophon">通信行业日报 · ${esc(issue.date || "")}</p>
    </div>`;

  const heroImg = main.querySelector(".hero-img");
  if (heroImg) heroImg.addEventListener("error", () => heroImg.remove());

  const deep = hashId();
  if (catalog.has(deep)) openModal(deep, { fromHistory: true });
  else if (deep === "archive") document.getElementById("archive")?.scrollIntoView();
}

function motionOk() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setPageInert(on) {
  for (const el of document.body.children) {
    if (el === modalRoot) continue;
    el.inert = on;
  }
}

function lockScroll() {
  lockedScroll = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScroll}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockScroll() {
  const y = lockedScroll;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, y);
}

function fillModal(entry) {
  const source = entry.detail.trim() ? entry.detail : entry.summary;
  const english = entry.titleEn ? `<p class="modal-en">${esc(entry.titleEn)}</p>` : "";
  const authors = entry.authors ? `<p class="modal-authors">${esc(entry.authors)}</p>` : "";
  modalBody.innerHTML = `
    <p class="modal-kicker">${chipHtml(entry.emoji, entry.category)}<span class="modal-date">${esc(entry.date)}</span></p>
    <h2 id="modal-title">${esc(entry.title)}</h2>
    ${english}
    ${authors}
    <div class="modal-copy">${paragraphs(source)}</div>
    ${renderLinks(entry.links)}
  `;
}

function openModal(id, { push = false, fromHistory = false, returnFocus = null } = {}) {
  const entry = catalog.get(id);
  if (!entry) return;
  const firstOpen = !modalId;
  fillModal(entry);
  if (firstOpen) {
    opener = fromHistory ? null : (returnFocus || document.activeElement);
    lockScroll();
    setPageInert(true);
    modalRoot.classList.remove("is-closed");
    void modalRoot.offsetWidth;
    modalRoot.classList.add("is-open");
    document.addEventListener("keydown", onModalKey);
  }
  modalId = id;
  requestAnimationFrame(() => {
    if (modalId === id) modalClose.focus({ preventScroll: true });
  });
  if (push) {
    const url = new URL(location.href);
    url.hash = id;
    history.pushState({ modal: id }, "", url);
  }
}

function finishClose(clearHash) {
  modalRoot.classList.add("is-closed");
  modalBody.innerHTML = "";
  setPageInert(false);
  unlockScroll();
  const back = opener;
  opener = null;
  if (clearHash) {
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}

function closeModal({ clearHash = false } = {}) {
  if (!modalId && modalRoot.classList.contains("is-closed")) return;
  modalId = "";
  document.removeEventListener("keydown", onModalKey);
  modalRoot.classList.remove("is-open");
  if (!motionOk()) {
    finishClose(clearHash);
    return;
  }
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    modalRoot.removeEventListener("transitionend", onEnd);
    finishClose(clearHash);
  };
  const onEnd = (event) => {
    if (event.target === modalRoot && event.propertyName === "opacity") done();
  };
  modalRoot.addEventListener("transitionend", onEnd);
  window.setTimeout(done, 280);
}

function requestClose() {
  if (!modalId) return;
  if (history.state && history.state.modal) {
    history.back();
    return;
  }
  closeModal({ clearHash: hashId() === modalId });
}

function onModalKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = [...modalDialog.querySelectorAll("a[href], button:not([disabled])")];
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

modalRoot.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) requestClose();
});

document.addEventListener("click", (event) => {
  const card = event.target.closest(".story-card");
  if (!card || !main.contains(card)) return;
  openModal(card.dataset.item, { push: true, returnFocus: card });
});

window.addEventListener("popstate", () => {
  const id = hashId();
  if (id && catalog.has(id)) openModal(id, { fromHistory: true });
  else if (modalId) closeModal();
});

function normalizeIndex(index) {
  const raw = Array.isArray(index?.issues) ? index.issues : [];
  const sorted = raw
    .filter((item) => item && typeof item === "object")
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const seen = new Set();
  return sorted.filter((item) => {
    if (!item.date || seen.has(item.date)) return false;
    seen.add(item.date);
    return true;
  });
}

function show(message) {
  notionLink.hidden = true;
  if (modalId) closeModal();
  main.innerHTML = `<p class="status">${esc(message)}</p>`;
}

async function load() {
  if (location.protocol === "file:") {
    show("请用本地静态服务器打开本页，例如 python3 -m http.server。");
    return;
  }

  let issues = [];
  try {
    issues = normalizeIndex(await fetchJSON("issues/index.json"));
  } catch {
    show("目录没有载入。");
    return;
  }

  const wanted = requestedDate();
  if (wanted && !DATE_RE.test(wanted)) {
    document.title = "通信行业日报";
    const archive = issues.length ? renderArchive(issues, "") : "";
    notionLink.hidden = true;
    main.innerHTML = `<p class="status">日期格式应为 YYYY-MM-DD。</p><div class="page shell">${archive}</div>`;
    return;
  }

  const date = wanted || issues[0]?.date;
  if (!date) {
    show("还没有日报。");
    return;
  }

  try {
    const issue = await fetchJSON(`issues/${encodeURIComponent(date)}.json`);
    renderIssue(issue, issues);
  } catch {
    document.title = "通信行业日报";
    const archive = issues.length ? renderArchive(issues, "") : "";
    notionLink.hidden = true;
    main.innerHTML = `<p class="status">没有找到 ${esc(date)} 这一期。</p><div class="page shell">${archive}</div>`;
  }
}

load();
