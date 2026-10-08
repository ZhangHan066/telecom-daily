/* Renders issues/*.json. A new day only needs a JSON file and an index update. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const main = document.getElementById("main");
const notionLink = document.getElementById("notion-link");

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

function requestedDate() {
  const query = new URLSearchParams(location.search).get("d");
  if (query) return query;
  const hash = location.hash.replace(/^#/, "");
  if (hash.startsWith("d=")) {
    try {
      return decodeURIComponent(hash.slice(2));
    } catch {
      return hash.slice(2);
    }
  }
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
  return `<p class="links">${anchors.join('<span class="dot" aria-hidden="true"> · </span>')}</p>`;
}

function renderEntry(item, paper) {
  if (!item || typeof item !== "object") return "";
  const titleEn = paper && item.title_en
    ? `<p class="title-en">${esc(item.title_en)}</p>`
    : "";
  const authors = item.authors ? `<p class="authors">${esc(item.authors)}</p>` : "";
  const summary = item.summary ? `<p class="summary">${esc(item.summary)}</p>` : "";
  const date = item.date ? `<span class="entry-date">${esc(item.date)}</span>` : "";
  return `<details class="entry">
    <summary>
      <span class="entry-title">${esc(item.title || "")}</span>
      <span class="entry-side">${date}</span>
    </summary>
    <div class="entry-body">${titleEn}${authors}${summary}${renderLinks(item.links)}</div>
  </details>`;
}

function issueMeta(issue) {
  return [issue.date, issue.weekday].filter(Boolean).map(esc).join(" · ");
}

function renderSwitch(older, newer) {
  if (!older && !newer) return "";
  const link = (issue, kind, label) =>
    `<a class="switch-${kind}" href="?d=${esc(issue.date)}"><span class="switch-k">${label}</span><span class="switch-d">${issueMeta(issue)}</span></a>`;
  const oldLink = older ? link(older, "old", "‹ 更早") : "<span></span>";
  const newLink = newer ? link(newer, "new", "更新 ›") : "<span></span>";
  return `<nav class="switch" aria-label="前后期">${oldLink}${newLink}</nav>`;
}

function renderArchive(issues, current) {
  const items = issues.map((issue) => {
    const currentAttr = issue.date === current ? ' aria-current="page"' : "";
    const time = DATE_RE.test(issue.date || "")
      ? `<time datetime="${esc(issue.date)}">${esc(issue.date)}</time>`
      : esc(issue.date || "");
    return `<li><a href="?d=${esc(issue.date)}"${currentAttr}>
      <span class="arch-meta">${time}<span>${esc(issue.weekday || "")}</span></span>
      <span class="arch-theme">${esc(issue.theme || issue.title || "")}</span>
    </a></li>`;
  }).join("");
  return `<section class="archive" id="archive">
    <h2>往期</h2>
    <ul>${items}</ul>
  </section>`;
}

function renderHero(issue) {
  const cover = issue.cover && typeof issue.cover === "object" ? issue.cover : {};
  const coverUrl = safeUrl(cover.url);
  const image = coverUrl
    ? `<img class="hero-img" alt="" src="${esc(coverUrl)}" decoding="async">`
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
    return `<li><span class="hl-label">${esc(item.label || "")}</span><p>${esc(item.text || "")}</p></li>`;
  }).join("");
  return `<section class="highlights" aria-labelledby="hl-title">
    <h2 id="hl-title">今日要点</h2>
    <ul>${items}</ul>
  </section>`;
}

function renderIssue(issue, issues) {
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
        <h2 class="part-title" id="part-research">🛩️ 无人机通信科研</h2>
        ${research.map((item) => renderEntry(item, true)).join("")}
      </section>`
    : "";

  const groups = industry.map((group) => {
    if (!group || typeof group !== "object") return "";
    const items = Array.isArray(group.items) ? group.items : [];
    const emoji = group.emoji ? `${esc(group.emoji)} ` : "";
    return `<section class="sub">
      <h3 class="sub-title">${emoji}${esc(group.section || "")}</h3>
      ${items.map((item) => renderEntry(item, false)).join("")}
    </section>`;
  }).join("");

  const news = groups
    ? `<section class="part" aria-labelledby="part-industry">
        <h2 class="part-title" id="part-industry">📰 行业动态</h2>
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
    <div class="sheet wrap">
      ${switcher}
      ${renderHighlights(highlights)}
      ${papers}
      ${news}
      ${switcher}
      ${renderArchive(list, issue.date)}
      <p class="colophon">通信行业日报 · ${esc(issue.date || "")}</p>
    </div>`;

  const heroImg = main.querySelector(".hero-img");
  if (heroImg) heroImg.addEventListener("error", () => heroImg.remove());

  if (location.hash === "#archive") {
    document.getElementById("archive")?.scrollIntoView();
  }
}

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
    main.innerHTML = `<p class="status">日期格式应为 YYYY-MM-DD。</p><div class="wrap">${archive}</div>`;
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
    main.innerHTML = `<p class="status">没有找到 ${esc(date)} 这一期。</p><div class="wrap">${archive}</div>`;
  }
}

load();
