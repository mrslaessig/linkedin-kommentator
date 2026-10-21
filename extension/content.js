// LinkedIn Kommentator – Content Script für linkedin.com
// Zeigt Kommentar-Vorschläge, sobald ein Kommentarfeld fokussiert wird.
// Postet nie selbst: "Einfügen" schreibt nur Text ins Feld, absenden tust du.

(() => {
  if (window.__linkedinKommentator) return;

  const VERSION = chrome.runtime.getManifest().version;

  // ---------- Selektoren: nur erste Wahl. LinkedIn ändert Klassen oft, ----------
  // ---------- deshalb gibt es unten immer einen strukturellen Fallback. ----------

  const SEL = {
    commentBox: [".comments-comment-box", ".comments-comment-texteditor", "[class*='comments-comment-box']", "[data-view-name*='comment-box']"],
    replyBox: [".comments-comment-box--reply", "[class*='comment-box--reply']"],
    notComment: [".share-box", ".share-box-v2", ".share-creation-state", ".msg-form", ".msg-overlay-conversation-bubble", "[class*='msg-form']", "[class*='share-creation']"],
    post: ["[data-urn*='urn:li:activity']", "[data-id*='urn:li:activity']", ".feed-shared-update-v2", "[data-view-name='feed-full-update']"],
    postText: [".feed-shared-update-v2__description", ".update-components-text", ".feed-shared-inline-show-more-text", "[data-view-name='feed-commentary']"],
    postAuthor: [".update-components-actor__title span[aria-hidden='true']", ".update-components-actor__name span[aria-hidden='true']", ".update-components-actor__title"],
    commentItem: ["article.comments-comment-entity", ".comments-comment-entity", ".comments-comment-item", "[data-id*='urn:li:comment']"],
    commentText: [".comments-comment-item__main-content", ".comments-comment-entity__content", "[class*='comment-item__main-content']"],
    commentAuthor: [".comments-comment-meta__description-title", ".comments-post-meta__name-text span[aria-hidden='true']"],
  };
  const any = (list) => list.join(",");
  const closestAny = (el, list) => (el ? el.closest(any(list)) : null);

  const RE = {
    repost: /^(reposten|repost|teilen|share|weiterverbreiten)\b/i,
    mainPlaceholder: /kommentar hinzufügen|kommentieren|add a comment|comment/i,
    replyPlaceholder: /antwort|antworten|reply/i,
    notCommentHint: /worüber möchten|beitrag (erstellen|beginnen)|start a post|what do you want to talk|nachricht|message/i,
    notCommentContainer: /msg-|messaging|share-box|share-creation|sharebox|post-creation/i,
    socialProof: /gefällt das|gefällt dies|likes this|like this|kommentiert|commented|reposted|repostet|hat (das|dies) geteilt|findet das|finds this|loves this|celebrates|unterstützt|supports this|empfiehlt|insightful|interessant/i,
    seeMore: /^(…|\.\.\.)?\s*(mehr|more|see more|mehr anzeigen|…mehr)$/i,
    metaLine: /^(gefällt mir|like|antworten|reply|bearbeitet|edited|autor:in|autor|author|folgen|follow|•|·|\d+\s*(sek|min|std|tg|tag|tage|w|wo|mon|j|s|m|h|d|mo|y|yr)\.?|\d+|1st|2nd|3rd\+?|1\.|2\.|3\.\+?|\d+\s*(reaktion(en)?|reactions?|antworten|replies))$/i,
  };
  const BLOCK_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "UL", "OL", "TABLE", "FORM", "ASIDE", "NAV", "MAIN", "FIGURE"]);

  // ---------- Hilfsfunktionen ----------

  const isBefore = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(b);
  const isAfter = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) && !a.contains(b);
  const norm = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

  function textOf(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("button, script, style, svg, img, .visually-hidden, [class*='see-more'], [class*='show-more']").forEach((n) => n.remove());
    clone.querySelectorAll("a, span").forEach((n) => {
      if (RE.seeMore.test(norm(n.textContent))) n.remove();
    });
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p, div, li, h1, h2, h3, h4").forEach((b) => b.append("\n"));
    return clone.textContent
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s*(…|\.\.\.)\s*(mehr|more|see more|mehr anzeigen)\s*$/i, "")
      .trim();
  }

  function cleanName(s) {
    let n = (s || "").split(/\n|•|·|\|/)[0];
    n = norm(n)
      .replace(/^@/, "")
      .replace(/\s*\((sie|er|they|she|he)[^)]*\)\s*/gi, " ")
      .replace(/\s+(1st|2nd|3rd\+?|1\.|2\.|3\.\+?)(\s.*)?$/i, "")
      .replace(/\s+(Verifiziert|Verified|Premium|Profil anzeigen|View profile)(\s.*)?$/i, "")
      .trim();
    // LinkedIn wiederholt Namen manchmal für Screenreader: "Anna BAnna B"
    if (n.length % 2 === 0 && n.slice(0, n.length / 2) === n.slice(n.length / 2)) n = n.slice(0, n.length / 2);
    return n.slice(0, 120);
  }

  // Erster sichtbarer Textknoten: verhindert, dass Name und Headline zusammenkleben
  function firstText(el) {
    if (!el) return "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest(".visually-hidden, button")) continue;
      if (norm(n.textContent)) return n.textContent;
    }
    return "";
  }

  function nameOf(el) {
    return cleanName(firstText(el));
  }

  function linkName(a) {
    return nameOf(a.querySelector("span[aria-hidden='true']") || a);
  }

  const PROFILE_LINK = "a[href*='/in/'], a[href*='/company/']";
  const hrefKey = (a) => {
    try {
      return new URL(a.href, location.href).pathname.replace(/\/$/, "");
    } catch {
      return a.getAttribute("href") || "";
    }
  };

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function lca(a, b) {
    for (let el = a; el; el = el.parentElement) if (el.contains(b)) return el;
    return null;
  }

  function depth(el) {
    let d = 0;
    for (; el; el = el.parentElement) d++;
    return d;
  }

  // ---------- Kommentarfeld erkennen ----------

  function placeholderOf(editor) {
    const parts = [];
    for (let el = editor, i = 0; el && i < 4; el = el.parentElement, i++) {
      for (const attr of ["aria-placeholder", "data-placeholder", "placeholder", "aria-label"]) {
        const v = el.getAttribute(attr);
        if (v) parts.push(v);
      }
    }
    // Manche Editoren zeigen den Platzhalter als eigenes Element
    const ph = editor.parentElement?.querySelector("[class*='placeholder']");
    if (ph && ph !== editor && !editor.contains(ph)) parts.push(norm(ph.textContent));
    return norm(parts.join(" | ")).slice(0, 200);
  }

  function isExcluded(editor, hint) {
    if (location.pathname.startsWith("/messaging")) return true;
    if (closestAny(editor, SEL.notComment)) return true;
    for (let el = editor; el && el !== document.body; el = el.parentElement) {
      const sig = [el.className?.baseVal ?? el.className, el.getAttribute("data-view-name"), el.id].filter(Boolean).join(" ");
      if (RE.notCommentContainer.test(sig)) return true;
    }
    if (RE.notCommentHint.test(hint) && !RE.mainPlaceholder.test(hint) && !RE.replyPlaceholder.test(hint)) return true;
    return false;
  }

  function findEditor(target) {
    if (!(target instanceof Element)) return null;
    const editor = target.closest("[contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']");
    if (!editor || !editor.isContentEditable) return null;
    return editor;
  }

  // Post-Aktionsleiste: die nächste Gruppe VOR dem Feld mit einem Repost/Teilen-Button.
  // Kommentare haben keinen Repost-Button.
  function isRepostButton(b) {
    const label = norm(b.getAttribute("aria-label") || "");
    const text = norm(b.textContent);
    return (text.length < 40 && RE.repost.test(text)) || RE.repost.test(label);
  }

  function findActionBar(editor) {
    for (let anc = editor.parentElement; anc && anc !== document.documentElement; anc = anc.parentElement) {
      const reposts = [...anc.querySelectorAll("button, [role='button']")].filter(isRepostButton);
      const before = reposts.filter((b) => isBefore(b, editor));
      if (!before.length) continue;
      // Container mit vielen Repost-Buttons = ganzer Feed, nicht ein Post
      if (reposts.length > 3 || anc === document.body || anc.tagName === "MAIN") return null;
      const btn = before[before.length - 1];
      let bar = btn.parentElement;
      while (bar && bar !== anc && bar.querySelectorAll("button, [role='button']").length < 3) bar = bar.parentElement;
      return { bar: bar || btn, container: anc };
    }
    return null;
  }

  function isLeafBlock(el) {
    for (const c of el.children) if (BLOCK_TAGS.has(c.tagName)) return false;
    return true;
  }

  function isSocialProofLink(a) {
    if (RE.socialProof.test(norm(a.textContent))) return true;
    const own = norm(a.textContent).length;
    for (let el = a.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) {
      const t = norm(el.textContent);
      if (t.length > own) return t.length < 200 && RE.socialProof.test(t);
    }
    return false;
  }

  // ---------- Post lesen ----------

  function readPost(editor) {
    const found = findActionBar(editor);
    let container, bar;
    if (found) ({ container, bar } = found);
    else container = closestAny(editor, SEL.post);
    if (!container) return { container: null, bar: null, postText: "", author: "", authorLink: null };

    const beforeBar = (el) => (bar ? isBefore(el, bar) && !el.contains(bar) : !closestAny(el, SEL.commentItem));

    // Text: erst Selektoren, dann längster Textblock vor der Leiste
    let postText = "";
    const selEls = [...container.querySelectorAll(any(SEL.postText))].filter(beforeBar);
    const outer = selEls.filter((el) => !selEls.some((o) => o !== el && o.contains(el)));
    postText = [...new Set(outer.map(textOf).filter(Boolean))].join("\n\n[Geteilter Beitrag]\n");
    if (!postText) {
      let best = null;
      let bestLen = 0;
      for (const el of container.querySelectorAll("*")) {
        if (el.closest("button, a") || !beforeBar(el) || !isLeafBlock(el)) continue;
        const len = norm(el.textContent).length;
        if (len > bestLen) {
          best = el;
          bestLen = len;
        }
      }
      if (best && bestLen > 15) postText = textOf(best);
    }

    // Autor:in: erst Selektoren, dann erster Profil-Link mit Namen vor der Leiste
    let author = "";
    let authorLink = null;
    for (const el of container.querySelectorAll(any(SEL.postAuthor))) {
      if (beforeBar(el) && (author = nameOf(el))) break;
    }
    for (const a of container.querySelectorAll(PROFILE_LINK)) {
      if (!beforeBar(a) || isSocialProofLink(a)) continue;
      const name = linkName(a);
      if (!name || name.length < 2) continue;
      authorLink = a;
      if (!author) author = name;
      break;
    }

    return { container, bar, postText: postText.slice(0, 15000), author, authorLink };
  }

  // ---------- Antwort oder Hauptkommentar ----------

  function findMention(editor) {
    const el = editor.querySelector(`${PROFILE_LINK}, [data-mention], [data-entity-urn], [data-entity-type], [class*='mention']`);
    const name = el ? cleanName(el.textContent) : "";
    return name ? { el, name } : null;
  }

  function classify(editor, hint, mention) {
    if (closestAny(editor, SEL.replyBox)) return "reply";
    const isReply = RE.replyPlaceholder.test(hint);
    const isMain = RE.mainPlaceholder.test(hint) && !isReply;
    if (isMain) return "main"; // Hauptkommentar-Feld nie als Antwort behandeln
    if (isReply) return "reply";
    return mention ? "reply" : "main";
  }

  const sameName = (a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x === y || x.startsWith(y + " ") || y.startsWith(x + " ");
  };

  // Root des Feldes: höchster Vorfahre, der den Kommentar-Link noch nicht enthält
  function editorRoot(editor, link) {
    let root = editor;
    while (root.parentElement && !root.parentElement.contains(link)) root = root.parentElement;
    return root;
  }

  function readReply(editor, post, mention) {
    const container = post.container || document.body;
    const editorBox = editor.parentElement || editor;
    const links = [...container.querySelectorAll(PROFILE_LINK)].filter(
      (a) => isBefore(a, editorBox) && !editor.contains(a) && (!post.bar || isAfter(a, post.bar))
    );
    const named = links.filter((a) => linkName(a));
    // Autor-Links von Kommentaren: vorher steht ein Avatar-Link auf dasselbe Profil
    const avatarKeys = new Set(links.filter((a) => !linkName(a)).map(hrefKey));
    const starts = named.filter((a) => avatarKeys.has(hrefKey(a)));
    const pool = starts.length ? starts : named;

    // 1. Wahl: Selektoren
    let item = closestAny(editor, SEL.commentItem);
    if (item && !mention) {
      const textEl = [...item.querySelectorAll(any(SEL.commentText))].find((el) => closestAny(el, SEL.commentItem) === item);
      const authorEl = [...item.querySelectorAll(any(SEL.commentAuthor))].find((el) => closestAny(el, SEL.commentItem) === item);
      const text = textOf(textEl);
      if (text) return { text: text.slice(0, 5000), author: authorEl ? nameOf(authorEl) : "" };
    }

    // Struktureller Weg: Name-Link der erwähnten Person vor dem Feld
    let link = null;
    if (mention) link = [...pool].reverse().find((a) => sameName(linkName(a), mention.name)) || [...named].reverse().find((a) => sameName(linkName(a), mention.name));
    if (!link) link = pool[pool.length - 1];
    if (!link) return null;

    // Ende: nächster Kommentar-Anfang (Avatar-Link) oder das Feld
    const root = editorRoot(editor, link);
    const nextStart = links.find((a) => isAfter(a, link) && !linkName(a) && hrefKey(a) !== hrefKey(link));
    const end = nextStart && isBefore(nextStart, root) ? nextStart : root;

    // Textblöcke zwischen Link und Ende. Kopfzeile (Headline, Zeit) liegt dichter am Link als der Kommentartext.
    const scope = lca(link, end) || container;
    const blocks = [];
    for (const el of scope.querySelectorAll("*")) {
      if (!isAfter(el, link) || !isBefore(el, end) || el.contains(link) || el.closest("button, a")) continue;
      if (!isLeafBlock(el)) continue;
      const t = textOf(el);
      if (!t || RE.metaLine.test(t) || sameName(t, linkName(link))) continue;
      if (blocks.some((b) => b.el.contains(el) || el.contains(b.el))) continue;
      blocks.push({ el, t, d: depth(lca(el, link)) });
    }
    if (!blocks.length) return null;
    const minD = Math.min(...blocks.map((b) => b.d));
    const text = blocks
      .filter((b) => b.d === minD)
      .map((b) => b.t)
      .join("\n")
      .trim();
    return text ? { text: text.slice(0, 5000), author: linkName(link) } : null;
  }

  function postId(container) {
    const m = location.href.match(/urn:li:(activity|ugcPost|share):\d+/);
    if (!container) return m ? m[0] : "";
    for (let el = container; el && el !== document.body; el = el.parentElement) {
      const v = el.getAttribute("data-urn") || el.getAttribute("data-id") || el.getAttribute("data-activity-urn");
      if (v && /urn:li:/.test(v)) return v;
    }
    const inner = container.querySelector("[data-urn*='urn:li:activity'], [data-id*='urn:li:activity']");
    return inner?.getAttribute("data-urn") || inner?.getAttribute("data-id") || (m ? m[0] : "");
  }

  function readContext(editor) {
    const hint = placeholderOf(editor);
    const mention = findMention(editor);
    const mode = classify(editor, hint, mention);
    const post = readPost(editor);
    const replyTo = mode === "reply" ? readReply(editor, post, mention) : null;
    return {
      editor,
      hint,
      mode,
      barFound: Boolean(post.bar),
      postText: post.postText,
      author: post.author,
      replyTo,
      id: postId(post.container),
    };
  }

  function isCommentEditor(editor) {
    const hint = placeholderOf(editor);
    if (isExcluded(editor, hint)) return false;
    if (closestAny(editor, SEL.commentBox)) return true;
    if (RE.mainPlaceholder.test(hint) || RE.replyPlaceholder.test(hint)) return true;
    return Boolean(findActionBar(editor));
  }

  function diagnose(ctx) {
    const chain = [];
    for (let el = ctx?.editor; el && el !== document.documentElement && chain.length < 30; el = el.parentElement) {
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(" ") : "";
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls,
        view: el.getAttribute("data-view-name") || undefined,
        role: el.getAttribute("role") || undefined,
        aria: el.getAttribute("aria-label")?.slice(0, 60) || undefined,
      });
    }
    return {
      version: VERSION,
      url: location.pathname,
      placeholder: ctx?.hint || "",
      mode: ctx?.mode,
      actionBarFound: Boolean(ctx?.barFound),
      postId: ctx?.id || "",
      author: ctx?.author || "",
      post: (ctx?.postText || "").slice(0, 200),
      comment: ctx?.replyTo ? { author: ctx.replyTo.author, text: ctx.replyTo.text.slice(0, 200) } : null,
      ancestors: chain,
    };
  }

  // ---------- Panel (Shadow DOM) ----------

  const host = document.createElement("div");
  host.id = "linkedin-kommentator";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483000; right: 20px; bottom: 20px;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel {
    --bg: #ffffff; --fg: #1c2430; --muted: #5d6877; --line: #dde3ea; --soft: #f5f8fa;
    --accent: #2a6f97; --accent-soft: #eaf3f8; --on-accent: #ffffff;
    --err: #a3392f; --err-soft: #fbeeec; --warn: #7a5a00; --warn-soft: #fff6dc;
    width: 380px; max-width: calc(100vw - 40px); max-height: 78vh; display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 12px 32px rgba(20, 30, 45, .18), 0 2px 6px rgba(20, 30, 45, .08);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .panel[hidden] { display: none; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--line); }
  .title { font-weight: 700; font-size: 14px; flex: 1; white-space: nowrap; }
  .title span { color: var(--accent); }
  .lang { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
  .lang button { border: 0; padding: 2px 9px; font-size: 12px; background: transparent; color: var(--muted); }
  .lang button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
  .ctx { padding: 8px 14px 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .previews { padding: 4px 14px 0; display: grid; gap: 2px; }
  details { font-size: 12px; color: var(--muted); }
  summary { cursor: pointer; padding: 2px 0; }
  summary:hover { color: var(--accent); }
  details pre { margin: 4px 0 6px; padding: 8px 10px; max-height: 140px; overflow: auto; background: var(--soft); border-radius: 8px;
    white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--fg); }
  .warn { margin: 8px 14px 0; padding: 6px 10px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 12px; }
  .warn[hidden] { display: none; }
  .body { padding: 10px 14px 12px; overflow-y: auto; display: grid; gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  button {
    font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 999px;
    padding: 5px 12px; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .icon { border: 0; padding: 4px 8px; font-size: 15px; line-height: 1; color: var(--muted); background: transparent; }
  footer { display: grid; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--line); }
  .actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--muted); }
  .link { border: 0; padding: 0; background: none; font-size: 11px; font-weight: 500; color: var(--accent); text-decoration: underline; border-radius: 0; }
  .note { font-size: 12px; color: var(--muted); }
  .loading { display: grid; gap: 10px; }
  .skeleton { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 8px; }
  .bar { height: 10px; border-radius: 6px; background: linear-gradient(90deg, var(--accent-soft), #f6f9fb, var(--accent-soft)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
  .bar.s { width: 30%; } .bar.m { width: 70%; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
  .error { background: var(--err-soft); color: var(--err); border-radius: 10px; padding: 10px 12px; }
</style>
<div class="panel" hidden role="dialog" aria-label="LinkedIn Kommentator">
  <header>
    <div class="title">LinkedIn <span>Kommentator</span></div>
    <div class="lang" role="group" aria-label="Sprache">
      <button data-lang="auto" title="Sprache des Posts bzw. Kommentars">Auto</button>
      <button data-lang="de">DE</button>
      <button data-lang="en">EN</button>
    </div>
    <button class="icon" data-act="close" title="Schließen (Esc)" aria-label="Schließen">✕</button>
  </header>
  <div class="ctx"></div>
  <div class="previews"></div>
  <div class="warn" hidden></div>
  <div class="body"></div>
  <footer>
    <div class="actions">
      <span class="note"></span>
      <div class="row">
        <button data-act="regen">Neu generieren</button>
        <button data-act="close">Schließen</button>
      </div>
    </div>
    <div class="meta">
      <span class="version"></span>
      <button class="link" data-act="diag">Diagnose kopieren</button>
    </div>
  </footer>
</div>`;

  const $ = (s) => root.querySelector(s);
  const panel = $(".panel");
  const ctxEl = $(".ctx");
  const previewsEl = $(".previews");
  const warnEl = $(".warn");
  const bodyEl = $(".body");
  const noteEl = $(".note");
  const regenBtn = $("[data-act='regen']");
  $(".version").textContent = `Version ${VERSION}`;

  let current = null; // Kontext des aktiven Feldes
  let suggestions = [];
  let requestSeq = 0;
  let language = "auto";
  let healthChecked = false;

  chrome.storage.local.get("language").then(({ language: l }) => {
    if (["auto", "de", "en"].includes(l)) language = l;
    renderLang();
  }).catch(() => renderLang());

  function renderLang() {
    root.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === language)));
  }

  // Klicks im Panel sollen dem Kommentarfeld nicht den Fokus nehmen
  root.addEventListener("mousedown", (e) => e.preventDefault());
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.lang) return setLanguage(btn.dataset.lang);
    const act = btn.dataset.act;
    if (act === "close") hide();
    else if (act === "regen") generate(true);
    else if (act === "insert") insertText(Number(btn.dataset.idx));
    else if (act === "copy") copyText(suggestions[Number(btn.dataset.idx)]?.text, btn, "Kopiert");
    else if (act === "diag") copyText(JSON.stringify(diagnose(current), null, 2), btn, "Diagnose kopiert");
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !panel.hidden) hide();
    },
    true
  );

  function setLanguage(l) {
    if (l === language) return;
    language = l;
    renderLang();
    chrome.storage.local.set({ language }).catch(() => {});
    if (current) generate(false);
  }

  function show() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    panel.hidden = false;
    checkVersion();
  }
  function hide() {
    panel.hidden = true;
    requestSeq++; // laufende Anfrage ignorieren
  }

  async function checkVersion() {
    if (healthChecked) return;
    try {
      const h = await chrome.runtime.sendMessage({ type: "health" });
      if (h?.version) {
        healthChecked = true;
        showVersionHint(h.version);
      }
    } catch {}
  }

  function showVersionHint(serverVersion) {
    if (!serverVersion || serverVersion === VERSION) {
      warnEl.hidden = true;
      return;
    }
    warnEl.hidden = false;
    warnEl.textContent = `Versionen passen nicht zusammen: Erweiterung ${VERSION}, Server ${serverVersion}. Bitte Server neu starten bzw. die Erweiterung in chrome://extensions neu laden.`;
  }

  function preview(summary, text) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = summary;
    const pre = document.createElement("pre");
    pre.textContent = text || "(nichts gefunden)";
    d.append(s, pre);
    return d;
  }

  function renderContext() {
    previewsEl.replaceChildren();
    if (!current) return (ctxEl.textContent = "");
    ctxEl.textContent = current.replyTo
      ? `Antwort an ${current.replyTo.author || "Kommentar"} · Post von ${current.author || "unbekannt"}`
      : `Kommentar zum Post von ${current.author || "unbekannt"}`;
    previewsEl.append(preview("Gelesener Post", current.postText));
    if (current.replyTo) previewsEl.append(preview(`Kommentar von ${current.replyTo.author || "unbekannt"}`, current.replyTo.text));
  }

  function renderLoading() {
    const sk = `<div class="skeleton"><div class="bar s"></div><div class="bar"></div><div class="bar m"></div></div>`;
    bodyEl.innerHTML = `<div class="loading" aria-live="polite"><div class="note">Schreibe Vorschläge …</div>${sk}${sk}</div>`;
    noteEl.textContent = "";
    regenBtn.disabled = true;
  }

  function renderError(msg) {
    const box = document.createElement("div");
    box.className = "error";
    box.setAttribute("role", "alert");
    box.textContent = msg;
    bodyEl.replaceChildren(box);
    noteEl.textContent = "";
    regenBtn.disabled = !current;
  }

  function renderSuggestions(list, cached) {
    suggestions = list;
    bodyEl.replaceChildren(
      ...list.map((s, i) => {
        const card = document.createElement("div");
        card.className = "card";
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = s.label;
        const p = document.createElement("p");
        p.className = "text";
        p.textContent = s.text;
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<button class="primary" data-act="insert" data-idx="${i}">Einfügen</button><button data-act="copy" data-idx="${i}">Kopieren</button>`;
        card.append(label, p, row);
        return card;
      })
    );
    noteEl.textContent = cached ? "Aus dem Cache" : "";
    regenBtn.disabled = false;
  }

  function cacheKey(ctx) {
    return [ctx.id || "t:" + hash(ctx.postText), ctx.replyTo ? "c:" + hash(ctx.replyTo.text) : "", language].join("|");
  }

  async function generate(force) {
    if (!current) return;
    const seq = ++requestSeq;
    show();
    renderLoading();
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: "suggest",
        cacheKey: cacheKey(current),
        force,
        payload: { postText: current.postText, author: current.author, replyTo: current.replyTo, language },
      });
    } catch {
      res = { ok: false, error: "Die Erweiterung wurde neu geladen. Bitte die LinkedIn-Seite neu laden (F5)." };
    }
    if (seq !== requestSeq) return; // veraltet
    if (!res) res = { ok: false, error: "Keine Antwort von der Erweiterung. Bitte die Seite neu laden." };
    if (res.serverVersion) showVersionHint(res.serverVersion);
    if (res.ok) renderSuggestions(res.suggestions, res.cached);
    else renderError(res.error);
  }

  // ---------- Einfügen & Kopieren ----------

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertText(idx) {
    const s = suggestions[idx];
    const editor = current?.editor?.isConnected ? current.editor : null;
    if (!s) return;
    if (!editor) return renderError("Kommentarfeld nicht mehr gefunden. Bitte erneut ins Feld klicken.");
    editor.focus();
    // Immer ans Ende, also hinter eine vorhandene @Erwähnung
    placeCaretAtEnd(editor);
    const existing = editor.textContent.replace(/ /g, " ");
    const text = (existing.trim() && !/\s$/.test(existing) ? " " : "") + s.text;
    const before = editor.textContent;
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {}
    if (!ok || editor.textContent === before) {
      // Fallback, falls execCommand nicht greift
      const target = editor.querySelector("p:last-of-type") || editor;
      target.append(document.createTextNode(text));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      placeCaretAtEnd(editor);
    }
    noteEl.textContent = "Eingefügt. Du entscheidest, ob du postest.";
  }

  async function copyText(text, btn, done) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      root.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = done;
    setTimeout(() => (btn.textContent = old), 1500);
  }

  // ---------- Auslöser ----------

  function onEditor(editor) {
    if (!isCommentEditor(editor)) return;
    // Kurz warten: LinkedIn füllt die @Erwähnung im Antwortfeld erst nach dem Fokus ein
    setTimeout(() => {
      let ctx;
      try {
        ctx = readContext(editor);
      } catch (err) {
        console.warn("[LinkedIn Kommentator]", err);
        current = { editor, hint: placeholderOf(editor) };
        show();
        renderContext();
        return renderError("Post konnte nicht gelesen werden. LinkedIn hat evtl. das Layout geändert. Bitte „Diagnose kopieren“ nutzen.");
      }
      if (!ctx.postText && !ctx.replyTo) {
        current = ctx;
        show();
        renderContext();
        return renderError("Kein Post-Text gefunden. Klappe den Post mit „…mehr“ auf und klicke erneut ins Kommentarfeld.");
      }
      // Gleicher Post, Panel offen: nichts neu laden
      if (current && !panel.hidden && current.editor === editor && cacheKey(current) === cacheKey(ctx)) return;
      current = ctx;
      renderContext();
      generate(false);
    }, 150);
  }

  document.addEventListener(
    "focusin",
    (e) => {
      if (e.composedPath().includes(host)) return;
      const editor = findEditor(e.target);
      if (editor) onEditor(editor);
    },
    true
  );
  // Nach "Schließen" bleibt der Fokus im Feld. Ein erneuter Klick hinein öffnet das Panel wieder.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!panel.hidden || e.composedPath().includes(host)) return;
      const editor = findEditor(e.target);
      if (editor && document.activeElement && editor.contains(document.activeElement)) onEditor(editor);
    },
    true
  );

  (document.body || document.documentElement).appendChild(host);
  window.__linkedinKommentator = { readContext, isCommentEditor, diagnose };
})();
