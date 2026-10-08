/* Renders issues/*.json. A new day only needs a JSON file and an index update. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_KEY = "telecom-daily-lang";
const SECTION_RANK = ["政策监管", "卫星与手机直连", "运营商", "设备商与 AI-RAN", "光通信与算力"];

const UI = {
  zh: {
    skip: "跳到正文",
    brand: "通信行业日报",
    nav: "站点",
    lang: "语言",
    archive: "往期",
    close: "关闭",
    loading: "载入中",
    file: "请用本地静态服务器打开本页，例如 python3 -m http.server。",
    indexFail: "目录没有载入。",
    badDate: "日期格式应为 YYYY-MM-DD。",
    empty: "还没有日报。",
    missing: (date) => `没有找到 ${date} 这一期。`,
    research: "无人机通信科研",
    industry: "行业动态",
    papers: (n) => `${n} 篇`,
    items: (n) => (n === 1 ? "1 条" : `${n} 条`),
    researchCat: "科研",
    earlier: "‹ 更早",
    later: "更新 ›",
    pager: "前后期",
    cover: "封面",
    source: "来源",
    colophon: (date) => `通信行业日报 · ${date}`,
    desc: "通信行业日报：无人机通信科研与行业动态。",
  },
  en: {
    skip: "Skip to content",
    brand: "Telecom Daily",
    nav: "Site",
    lang: "Language",
    archive: "Archive",
    close: "Close",
    loading: "Loading",
    file: "Open this page from a local static server, for example python3 -m http.server.",
    indexFail: "Could not load the index.",
    badDate: "Use a date in YYYY-MM-DD form.",
    empty: "No issues yet.",
    missing: (date) => `No issue for ${date}.`,
    research: "UAV communications research",
    industry: "Industry",
    papers: (n) => (n === 1 ? "1 paper" : `${n} papers`),
    items: (n) => (n === 1 ? "1 item" : `${n} items`),
    researchCat: "Research",
    earlier: "‹ Earlier",
    later: "Later ›",
    pager: "Issues",
    cover: "Cover",
    source: "Source",
    colophon: (date) => `Telecom Daily · ${date}`,
    desc: "Telecom Daily: UAV communications research and industry news.",
  },
};

const main = document.getElementById("main");
const notionLink = document.getElementById("notion-link");
const modalRoot = document.getElementById("modal-root");
const modalDialog = document.getElementById("modal-dialog");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");
const langZh = document.getElementById("lang-zh");
const langEn = document.getElementById("lang-en");

const catalog = new Map();
let lang = "zh";
let loadedIssue = null;
let loadedIssues = [];
let firstPaint = true;
let stopHeroMotion = () => {};
let modalId = "";
let opener = null;
let lockedScroll = 0;

try {
  if (localStorage.getItem(LANG_KEY) === "en") lang = "en";
} catch {
  lang = "zh";
}

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

function t(key) {
  return UI[lang][key];
}

function text(zh, en) {
  const zhText = typeof zh === "string" ? zh.trim() : "";
  const enText = typeof en === "string" ? en.trim() : "";
  if (lang === "en" && enText) return enText;
  return zhText || enText;
}

function applyChrome() {
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.getElementById("skip-link").textContent = t("skip");
  document.getElementById("brand").textContent = t("brand");
  document.getElementById("mast-nav").setAttribute("aria-label", t("nav"));
  document.getElementById("lang-switch").setAttribute("aria-label", t("lang"));
  document.getElementById("archive-link").textContent = t("archive");
  modalClose.setAttribute("aria-label", t("close"));
  langZh.setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
  langEn.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  setMeta("og:locale", lang === "en" ? "en_US" : "zh_CN", "property");
}

function setLang(next) {
  if (next !== "zh" && next !== "en" || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode */
  }
  applyChrome();
  if (loadedIssue) renderIssue(loadedIssue, loadedIssues);
}

langZh.addEventListener("click", () => setLang("zh"));
langEn.addEventListener("click", () => setLang("en"));

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
  const title = lang === "en"
    ? [t("brand"), issue.date].filter(Boolean).join(" · ")
    : (issue.title || t("brand"));
  const description = text(issue.theme, issue.theme_en) || t("desc");
  document.title = title;
  setMeta("description", description);
  setMeta("og:title", title, "property");
  setMeta("og:description", description, "property");
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
  const title = text(item.title, item.title_en);
  const summary = text(item.summary, item.summary_en);
  const detail = text(item.detail, item.detail_en);
  const paperTitle = typeof item.title_en === "string" ? item.title_en.trim() : "";
  catalog.set(meta.id, {
    id: meta.id,
    title,
    date: item.date || "",
    summary,
    detail,
    titleEn: meta.paper && lang === "zh" ? paperTitle : "",
    authors: item.authors || "",
    links: Array.isArray(item.links) ? item.links : [],
    emoji: meta.emoji || "",
    category: meta.category || "",
  });
  const number = String(meta.number).padStart(2, "0");
  return `<button type="button" class="story-card" id="${esc(meta.id)}" data-item="${esc(meta.id)}" aria-haspopup="dialog">
    <span class="card-title">${esc(title)}</span>
    <span class="card-summary"><span class="card-summary-text">${esc(summary)}</span></span>
    <span class="card-meta"><span class="item-no">${number}</span>${chipHtml(meta.emoji, meta.category)}<span class="card-date">${esc(item.date || "")}</span></span>
  </button>`;
}

function issueView(entry) {
  if (loadedIssue && entry.date === loadedIssue.date) {
    return {
      ...entry,
      weekday: loadedIssue.weekday || entry.weekday,
      weekday_en: loadedIssue.weekday_en || entry.weekday_en,
      theme: loadedIssue.theme || entry.theme,
      theme_en: loadedIssue.theme_en || entry.theme_en,
      title: loadedIssue.title || entry.title,
    };
  }
  return entry;
}

function issueMeta(issue) {
  const view = issueView(issue);
  return [view.date, text(view.weekday, view.weekday_en)].filter(Boolean).map(esc).join(" · ");
}

function renderSwitch(older, newer) {
  if (!older && !newer) return "";
  const link = (issue, kind, label) =>
    `<a class="pager-${kind}" href="?d=${esc(issue.date)}"><span class="pager-k">${label}</span><span class="pager-d">${issueMeta(issue)}</span></a>`;
  const oldLink = older ? link(older, "old", t("earlier")) : "<span></span>";
  const newLink = newer ? link(newer, "next", t("later")) : "<span></span>";
  return `<nav class="pager" aria-label="${esc(t("pager"))}">${oldLink}${newLink}</nav>`;
}

function renderArchive(issues, current) {
  const items = issues.map((issue) => {
    const view = issueView(issue);
    const currentAttr = view.date === current ? ' aria-current="page"' : "";
    const time = DATE_RE.test(view.date || "")
      ? `<time datetime="${esc(view.date)}">${esc(view.date)}</time>`
      : esc(view.date || "");
    return `<li><a class="arch-card" href="?d=${esc(view.date)}"${currentAttr}>
      <span class="arch-meta">${time}<span>${esc(text(view.weekday, view.weekday_en))}</span></span>
      <span class="arch-theme">${esc(text(view.theme, view.theme_en) || view.title || "")}</span>
    </a></li>`;
  }).join("");
  return `<section class="archive" id="archive">
    <h2>${esc(t("archive"))}</h2>
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
  const weekdayLabel = text(issue.weekday, issue.weekday_en);
  const weekday = weekdayLabel
    ? `<span class="hero-dot" aria-hidden="true"></span><span class="hero-weekday">${esc(weekdayLabel)}</span>`
    : "";
  return `<header class="hero">
    <div class="hero-frame">
      ${image}
      <div class="hero-shade" aria-hidden="true"></div>
      <canvas class="hero-motion" aria-hidden="true"></canvas>
      <div class="hero-copy">
        <h1>${esc(t("brand"))}</h1>
        <p class="hero-date">${dateText}${weekday}</p>
      </div>
    </div>
  </header>`;
}

function tuneHeroPlate(img) {
  const plate = img.closest(".hero-frame")?.querySelector(".hero-copy");
  if (!plate || !img.src) return;
  const probe = new Image();
  probe.crossOrigin = "anonymous";
  probe.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(probe, 0, Math.max(0, probe.naturalHeight * 0.55), probe.naturalWidth, probe.naturalHeight * 0.45, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      plate.classList.toggle("is-light", sum / (data.length / 4) / 255 > 0.62);
    } catch {
      plate.classList.remove("is-light");
    }
  };
  probe.onerror = () => plate.classList.remove("is-light");
  probe.src = img.currentSrc || img.src;
}

function mountHeroMotion(root) {
  const canvases = [...root.querySelectorAll("canvas.hero-motion")];
  if (!canvases.length) return () => {};
  const scenes = canvases.map((canvas) => {
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx, kind: canvas.dataset.motion || "plate" } : null;
  }).filter(Boolean);
  if (!scenes.length) return () => {};

  const ac = new AbortController();
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  const t0 = performance.now();
  const orbits = [
    { cx: 0.5, cy: 0.74, rx: 0.32, ry: 0.16, speed: 0.42, tilt: -0.38, color: "research", n: 7, depth: 0.55 },
    { cx: 0.5, cy: 0.8, rx: 0.18, ry: 0.12, speed: -0.33, tilt: 0.48, color: "industry", n: 5, depth: 0.82 },
    { cx: 0.62, cy: 0.7, rx: 0.1, ry: 0.09, speed: 0.58, tilt: 0.18, color: "research", n: 4, depth: 1 },
  ];

  function luma(hex) {
    const h = String(hex || "").trim().replace("#", "");
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    const n = Number.parseInt(full, 16);
    if (!Number.isFinite(n)) return 0.2;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function rgba(hex, alpha) {
    const h = String(hex || "").trim().replace("#", "");
    const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
    if (!Number.isFinite(n)) return `rgba(36, 62, 154, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    return {
      research: cs.getPropertyValue("--research").trim() || "#243e9a",
      industry: cs.getPropertyValue("--industry").trim() || "#0e6b62",
    };
  }

  function resize(scene) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = scene.canvas.clientWidth;
    const height = scene.canvas.clientHeight;
    if (width < 2 || height < 2) return false;
    scene.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene.canvas.width = Math.round(width * dpr);
    scene.canvas.height = Math.round(height * dpr);
    scene.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function drawScene(scene, t) {
    const { ctx, canvas, kind } = scene;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const ink = palette();
    const quiet = kind === "frame" ? 0.45 : 0.62;
    const wobble = Math.sin(t * 0.35) * 0.1;
    ctx.clearRect(0, 0, w, h);
    const placed = [];
    for (const orbit of orbits) {
      const color = rgba(ink[orbit.color], 1);
      const tone = quiet * (luma(ink[orbit.color]) > 0.5 ? 0.55 : 1);
      ctx.save();
      ctx.translate(orbit.cx * w, orbit.cy * h);
      ctx.rotate(orbit.tilt + wobble * orbit.depth);
      ctx.beginPath();
      ctx.ellipse(0, 0, orbit.rx * w, orbit.ry * h, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.1 * tone;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < orbit.n; i += 1) {
        const ang = (i / orbit.n) * Math.PI * 2 + t * orbit.speed;
        const rx = orbit.rx * w;
        const ry = orbit.ry * h;
        const lx = Math.cos(ang) * rx;
        const ly = Math.sin(ang) * ry;
        const tilt = orbit.tilt + wobble * orbit.depth;
        const c = Math.cos(tilt);
        const s = Math.sin(tilt);
        placed.push({
          x: orbit.cx * w + lx * c - ly * s,
          y: orbit.cy * h + lx * s + ly * c,
          color,
          r: (i % 3 === 0 ? 2.2 : 1.35) * (0.75 + orbit.depth * 0.4),
          alpha: (0.22 + orbit.depth * 0.16) * tone,
        });
      }
    }
    for (const dot of placed) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fillStyle = dot.color;
      ctx.globalAlpha = dot.alpha;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    for (const scene of scenes) drawScene(scene, t);
  }

  function tick(now) {
    draw((now - t0) / 1000);
    raf = requestAnimationFrame(tick);
  }

  const frame = root.querySelector(".hero-frame");
  let live = false;

  function paint() {
    for (const scene of scenes) resize(scene);
    draw(reduceQuery.matches ? 1.35 : (performance.now() - t0) / 1000);
  }

  function stop() {
    live = false;
    frame?.classList.remove("is-live");
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function start() {
    if (reduceQuery.matches || live) return;
    live = true;
    frame?.classList.add("is-live");
    raf = requestAnimationFrame(tick);
  }

  paint();
  frame?.addEventListener("pointerenter", start, { signal: ac.signal });
  frame?.addEventListener("pointerleave", stop, { signal: ac.signal });
  frame?.addEventListener("focusin", start, { signal: ac.signal });
  frame?.addEventListener("focusout", (event) => {
    if (!frame?.contains(event.relatedTarget)) stop();
  }, { signal: ac.signal });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
  for (const scene of scenes) ro?.observe(scene.canvas);
  reduceQuery.addEventListener("change", () => {
    stop();
    paint();
  }, { signal: ac.signal });

  return () => {
    ac.abort();
    cancelAnimationFrame(raf);
    ro?.disconnect();
  };
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
  const switcher = renderSwitch(older, newer);
  const orderedIndustry = industry
    .map((group, gi) => ({ group, gi }))
    .filter((entry) => entry.group && typeof entry.group === "object")
    .sort((a, b) => {
      const rank = (name) => {
        const index = SECTION_RANK.indexOf(name || "");
        return index === -1 ? SECTION_RANK.length : index;
      };
      return rank(a.group.section) - rank(b.group.section) || a.gi - b.gi;
    });

  const papers = research.length
    ? `<section class="panel panel-research" aria-labelledby="part-research">
        <header class="sec-head">
          <h2 id="part-research">🛩️ ${esc(t("research"))}</h2>
          <span class="sec-count">${esc(t("papers")(research.length))}</span>
        </header>
        <div class="rows">${research.map((item, i) => registerCard(item, {
          id: `item-r-${i}`,
          number: i + 1,
          paper: true,
          emoji: "🛩️",
          category: t("researchCat"),
        })).join("")}</div>
      </section>`
    : "";

  let industryNumber = 0;
  const groups = orderedIndustry.map(({ group, gi }) => {
    const items = Array.isArray(group.items) ? group.items : [];
    const emoji = group.emoji || "";
    const section = text(group.section, group.section_en);
    const rows = items.map((item, ii) => {
      industryNumber += 1;
      return registerCard(item, {
        id: `item-i-${gi}-${ii}`,
        number: industryNumber,
        paper: false,
        emoji,
        category: section,
      });
    }).join("");
    return `<section class="group">
      <h3 class="group-head"><span>${esc([emoji, section].filter(Boolean).join(" "))}</span><span class="group-count">${esc(t("items")(items.length))}</span></h3>
      <div class="rows">${rows}</div>
    </section>`;
  }).join("");

  const newsCount = industry.reduce((sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0), 0);
  const news = groups
    ? `<section class="panel panel-industry" aria-labelledby="part-industry">
        <header class="sec-head">
          <h2 id="part-industry">📰 ${esc(t("industry"))}</h2>
          <span class="sec-count">${esc(t("items")(newsCount))}</span>
        </header>
        <div class="groups">${groups}</div>
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
    <div id="content" class="content shell">
      <div class="board">
        ${papers}
        ${news}
      </div>
      ${switcher}
      ${renderArchive(list, issue.date)}
      <p class="colophon">${esc(t("colophon")(issue.date || ""))}</p>
    </div>`;

  const heroImg = main.querySelector(".hero-img");
  if (heroImg) {
    heroImg.addEventListener("error", () => heroImg.remove());
    if (heroImg.complete) tuneHeroPlate(heroImg);
    else heroImg.addEventListener("load", () => tuneHeroPlate(heroImg), { once: true });
  }
  stopHeroMotion();
  stopHeroMotion = mountHeroMotion(main);

  if (!firstPaint) return;
  firstPaint = false;
  const deep = hashId();
  if (catalog.has(deep)) openModal(deep, { fromHistory: true });
  else if (deep === "archive") document.getElementById("archive")?.scrollIntoView();
  scheduleAutoScroll();
}

function motionOk() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let autoScroll = null;

function returnedViaBack() {
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav && nav.type === "back_forward") return true;
  return Boolean(performance.navigation && performance.navigation.type === 2);
}

function deepLinkSkipsScroll() {
  const deep = hashId();
  return deep === "archive" || catalog.has(deep);
}

function cancelAutoScroll() {
  if (!autoScroll || autoScroll.cancelled) return;
  autoScroll.cancelled = true;
  clearTimeout(autoScroll.timer);
  if (autoScroll.raf) cancelAnimationFrame(autoScroll.raf);
  autoScroll.raf = 0;
  autoScroll.ac.abort();
}

function scheduleAutoScroll() {
  if (autoScroll || !motionOk() || returnedViaBack() || deepLinkSkipsScroll()) return;
  const target = document.getElementById("content");
  if (!target) return;

  const ac = new AbortController();
  autoScroll = { cancelled: false, raf: 0, timer: 0, ac };
  const opts = { signal: ac.signal, capture: true, passive: true };
  window.addEventListener("wheel", cancelAutoScroll, opts);
  window.addEventListener("touchstart", cancelAutoScroll, opts);
  window.addEventListener("keydown", cancelAutoScroll, opts);
  window.addEventListener("pointerdown", cancelAutoScroll, opts);

  autoScroll.timer = window.setTimeout(() => {
    if (!autoScroll || autoScroll.cancelled) return;
    if (window.scrollY > 8) {
      cancelAutoScroll();
      return;
    }
    const mastH = document.querySelector(".mast")?.offsetHeight || 0;
    const start = window.scrollY;
    const dest = Math.max(0, target.getBoundingClientRect().top + start - mastH);
    const distance = dest - start;
    if (distance < 8) {
      ac.abort();
      return;
    }
    const duration = 1000;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      if (!autoScroll || autoScroll.cancelled) return;
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + distance * ease(p));
      if (p < 1) autoScroll.raf = requestAnimationFrame(step);
      else {
        autoScroll.raf = 0;
        ac.abort();
      }
    };
    autoScroll.raf = requestAnimationFrame(step);
  }, 1350);
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) cancelAutoScroll();
});

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
    show(t("file"));
    return;
  }

  let issues = [];
  try {
    issues = normalizeIndex(await fetchJSON("issues/index.json"));
  } catch {
    show(t("indexFail"));
    return;
  }

  const wanted = requestedDate();
  if (wanted && !DATE_RE.test(wanted)) {
    document.title = t("brand");
    loadedIssues = issues;
    const archive = issues.length ? renderArchive(issues, "") : "";
    notionLink.hidden = true;
    main.innerHTML = `<p class="status">${esc(t("badDate"))}</p><div class="page shell">${archive}</div>`;
    return;
  }

  const date = wanted || issues[0]?.date;
  if (!date) {
    show(t("empty"));
    return;
  }

  try {
    const issue = await fetchJSON(`issues/${encodeURIComponent(date)}.json`);
    loadedIssue = issue;
    loadedIssues = issues;
    renderIssue(issue, issues);
  } catch {
    document.title = t("brand");
    loadedIssues = issues;
    const archive = issues.length ? renderArchive(issues, "") : "";
    notionLink.hidden = true;
    main.innerHTML = `<p class="status">${esc(t("missing")(date))}</p><div class="page shell">${archive}</div>`;
  }
}

const ASSET_RELOAD_KEY = "td-asset-reload";

function bakedAssetVersion() {
  const value = document.querySelector('meta[name="asset-version"]')?.getAttribute("content") || "";
  if (!value || value === "__ASSET_VERSION__") return "";
  return value;
}

function checkForUpdate() {
  const baked = bakedAssetVersion();
  if (!baked || location.protocol === "file:") return;
  const url = new URL("version.json", document.baseURI);
  url.searchParams.set("t", String(Date.now()));
  fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const remote = data && typeof data.version === "string" ? data.version.trim() : "";
      if (!remote || remote === baked) {
        try { sessionStorage.removeItem(ASSET_RELOAD_KEY); } catch { /* ignore */ }
        return;
      }
      let seen = "";
      try {
        seen = sessionStorage.getItem(ASSET_RELOAD_KEY) || "";
      } catch {
        return;
      }
      if (seen === remote) return;
      try {
        sessionStorage.setItem(ASSET_RELOAD_KEY, remote);
      } catch {
        return;
      }
      const next = new URL(location.href);
      next.searchParams.set("v", remote);
      location.replace(next.href);
    })
    .catch(() => {});
}

applyChrome();
load();
checkForUpdate();
