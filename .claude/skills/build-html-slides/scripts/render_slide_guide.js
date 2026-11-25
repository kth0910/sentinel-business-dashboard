#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPlaywright } = require('./playwright_loader');

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inlineMarkdown(value) {
  let escaped = escapeHtml(value);
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const safe = /^(?:https?:\/\/|\/|#|\.\.?\/)/i.test(href) ? escapeHtml(href) : '#';
    return `<a href="${safe}">${label}</a>`;
  });
  return escaped;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isTableDivider(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let listType = null;
  let slideSectionOpen = false;
  let subsectionOpen = false;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) blocks.push(`</${listType}>`);
    listType = null;
  };
  const closeSubsection = () => {
    if (subsectionOpen) blocks.push('</section>');
    subsectionOpen = false;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    if (line.startsWith('<!--')) continue;
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushParagraph();
      closeList();
      blocks.push(`<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"></figure>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      if (level <= 2) closeSubsection();
      if (level === 2) {
        if (slideSectionOpen) {
          blocks.push('</section>');
          slideSectionOpen = false;
        }
        const numberedSlide = heading[2].match(/^(\d+)\.\s+(.+)$/);
        if (numberedSlide) {
          const slideNumber = String(Number(numberedSlide[1])).padStart(2, '0');
          blocks.push(`<section class="guide-section" id="slide-${slideNumber}">`);
          slideSectionOpen = true;
        }
      }
      if (level === 3) {
        closeSubsection();
        blocks.push('<section class="guide-subsection">');
        subsectionOpen = true;
      }
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith('|') && lines[lineIndex + 1] && isTableDivider(lines[lineIndex + 1])) {
      flushParagraph();
      closeList();
      const headers = tableCells(line);
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim().startsWith('|')) {
        rows.push(tableCells(lines[lineIndex]));
        lineIndex += 1;
      }
      lineIndex -= 1;
      const head = headers.map(cell => `<th scope="col">${inlineMarkdown(cell)}</th>`).join('');
      const body = rows.map(row => `<tr>${headers.map((_header, index) => `<td>${inlineMarkdown(row[index] || '')}</td>`).join('')}</tr>`).join('');
      blocks.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      flushParagraph();
      closeList();
      blocks.push('<hr>');
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      closeList();
      blocks.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }
    const item = line.match(/^([-*]|\d+[.)])\s+(.+)$/);
    if (item) {
      flushParagraph();
      const wanted = /^\d/.test(item[1]) ? 'ol' : 'ul';
      if (listType !== wanted) {
        closeList();
        blocks.push(`<${wanted}>`);
        listType = wanted;
      }
      blocks.push(`<li>${inlineMarkdown(item[2])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  closeSubsection();
  if (slideSectionOpen) blocks.push('</section>');
  return blocks.join('\n');
}

function injectCaptures(markdown, captures, deckTitles) {
  const sectionPattern = /^##[ \t]+(\d+)\.[ \t]+(.+?)[ \t]*$/gm;
  const matches = [...markdown.matchAll(sectionPattern)];
  if (matches.length !== captures.length) {
    fail(`guide sections (${matches.length}) do not match deck slides (${captures.length})`);
  }
  let output = markdown;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const title = match[2].trim();
    const expectedNumber = index + 1;
    if (Number(match[1]) !== expectedNumber) fail(`expected guide section ${expectedNumber}`);
    if (title !== deckTitles[index].trim()) {
      fail(`slide ${expectedNumber} title mismatch: deck='${deckTitles[index]}', guide='${title}'`);
    }
    const imageLine = `![Slide ${expectedNumber} — ${title.replaceAll(']', '\\]')}](${captures[index]})`;
    const start = match.index + match[0].length;
    const tail = output.slice(start);
    const existingCapture = tail.match(/^\s*!\[[^\]\n]*\]\([^\n)]+\)(?:[ \t]*\r?\n)*/);
    const remainder = existingCapture
      ? tail.slice(existingCapture[0].length)
      : tail.replace(/^\s*/, '');
    output = `${output.slice(0, start)}\n\n${imageLine}\n\n${remainder}`;
  }
  return output;
}

function guideDocument(markdown, title, deckHref, markdownHref) {
  const sections = [...markdown.matchAll(/^##[ \t]+(\d+)\.[ \t]+(.+?)[ \t]*$/gm)];
  const index = sections.map(match => {
    const slideNumber = String(Number(match[1])).padStart(2, '0');
    return `<a href="#slide-${slideNumber}"><b>${slideNumber}</b><span>${inlineMarkdown(match[2])}</span></a>`;
  }).join('');
  return `<!doctype html>
<html lang="${/[가-힣]/.test(markdown) ? 'ko' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme:light; --ink:#182033; --muted:#5b6477; --line:#d9dfeb; --paper:#fff; --wash:#f4f6fa; --accent:#3157c8; --bar:#151b2a; --subsection:#f7f8fb; }
  * { box-sizing: border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; color:var(--ink); background:var(--wash); font-family:Inter, Pretendard, "Noto Sans KR", system-ui, sans-serif; line-height:1.72; word-break:keep-all; overflow-wrap:anywhere; }
  .guide-head { position:sticky; top:0; z-index:20; display:flex; min-height:62px; align-items:center; gap:16px; padding:9px clamp(18px,4vw,52px); color:#fff; background:var(--bar); border-bottom:4px solid var(--accent); }
  .guide-head strong { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .guide-head a { display:inline-flex; min-height:38px; align-items:center; padding:0 13px; border:1px solid #ffffff36; color:#fff; text-decoration:none; font-size:13px; font-weight:800; }
  .guide-head a:hover { border-color:#fff; background:#ffffff12; }
  .guide-layout { display:grid; width:min(1420px,100%); margin:0 auto; grid-template-columns:minmax(220px,290px) minmax(0,900px); gap:clamp(30px,5vw,76px); padding:clamp(34px,5vw,72px) clamp(18px,4vw,60px) 84px; }
  .guide-index { position:sticky; top:94px; align-self:start; max-height:calc(100vh - 118px); overflow:auto; border-top:2px solid var(--ink); }
  .guide-index h2 { margin:0; padding:15px 3px 13px; font:800 12px/1 ui-monospace,monospace; letter-spacing:.11em; }
  .guide-index a { display:grid; grid-template-columns:34px 1fr; gap:9px; padding:10px 3px; border-top:1px solid var(--line); color:var(--ink); text-decoration:none; font-size:12px; line-height:1.35; }
  .guide-index a:hover,.guide-index a.active { color:var(--accent); }
  .guide-index b { color:var(--accent); font-family:ui-monospace,monospace; }
  main { min-width:0; padding:54px 62px; background:var(--paper); border:1px solid var(--line); border-radius:16px; box-shadow:0 18px 50px rgba(28,39,66,.08); }
  h1 { margin:0 0 18px; font-size:2.35rem; line-height:1.18; letter-spacing:-.03em; }
  h2 { margin:58px 0 18px; padding-top:28px; border-top:2px solid var(--ink); font-size:1.65rem; line-height:1.3; }
  h3 { margin:0 0 12px; color:var(--accent); font-size:1.08rem; }
  p, li { font-size:1rem; }
  p { margin:10px 0 18px; }
  ul, ol { padding-left:1.5rem; }
  li + li { margin-top:8px; }
  figure { margin:20px 0 30px; }
  figure img { display:block; width:100%; aspect-ratio:16/9; object-fit:contain; background:#111; border:1px solid var(--line); border-radius:10px; }
  .guide-section { scroll-margin-top:86px; }
  .guide-section > h2 { margin-top:68px; }
  .guide-subsection { margin:18px 0; padding:20px 24px 20px 28px; background:var(--subsection); border-left:4px solid var(--accent); border-radius:0 14px 14px 0; }
  .guide-subsection > :last-child { margin-bottom:0; }
  .guide-subsection ul,.guide-subsection ol { margin-left:.35rem; }
  .table-wrap { width:100%; margin:20px 0 30px; overflow-x:auto; border:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; table-layout:fixed; background:#fff; }
  th,td { padding:12px 13px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:.9rem; line-height:1.55; word-break:break-word; overflow-wrap:anywhere; }
  th:last-child,td:last-child { border-right:0; }
  tr:last-child td { border-bottom:0; }
  th { color:#fff; background:var(--bar); font-weight:800; }
  blockquote { margin:18px 0 34px; padding:14px 18px; color:var(--muted); background:#f7f8fb; border-left:4px solid var(--accent); }
  code { padding:.12em .35em; background:#eef1f7; border-radius:4px; }
  hr { border:0; border-top:1px solid var(--line); margin:40px 0; }
  @media (max-width:850px) { .guide-layout { display:block; padding-top:28px; } .guide-index { position:relative; top:auto; max-height:none; margin-bottom:38px; } .guide-index div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); } main { padding:42px 34px; } }
  @media (max-width:560px) { .guide-head strong { font-size:13px; } .guide-head a { padding:0 9px; } .guide-layout { padding-inline:0; } .guide-index { margin-inline:18px; } .guide-index div { grid-template-columns:1fr; } main { width:100%; padding:34px 20px; border-inline:0; border-radius:0; } .guide-subsection { margin-inline:-4px; padding:18px 18px 18px 20px; } h1 { font-size:1.9rem; } }
  @page { size:A4; margin:14mm; }
  @media print {
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    html,body { background:#fff; }
    .guide-head,.guide-index { display:none!important; }
    .guide-layout { display:block; width:auto; margin:0; padding:0; }
    main { width:auto; margin:0; padding:0; border:0; border-radius:0; box-shadow:none; }
    .guide-section { break-before:page; }
    .guide-section > h2 { margin-top:0; padding-top:0; }
    .guide-subsection { break-inside:avoid-page; border-radius:0; }
    h1,h2,h3 { break-after:avoid-page; }
    figure,.table-wrap,blockquote,pre,li { break-inside:avoid-page; }
    figure img { border-radius:0; }
    .table-wrap { overflow:visible; }
    table { table-layout:fixed; }
    thead { display:table-header-group; }
    tr { break-inside:avoid-page; }
    th,td { padding:8px 9px; font-size:9.2pt; line-height:1.45; }
    a { color:inherit; text-decoration:none; }
  }
</style>
</head>
<body>
<header class="guide-head"><a href="${escapeHtml(deckHref)}">← 발표자료</a><strong>${escapeHtml(title)}</strong><a href="${escapeHtml(markdownHref)}">MD 원문</a></header>
<div class="guide-layout"><nav class="guide-index" aria-label="슬라이드 해설 목차"><h2>SLIDE INDEX</h2><div>${index}</div></nav><main>${markdownToHtml(markdown)}</main></div>
<script>const links=[...document.querySelectorAll('.guide-index a')];const sections=links.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){links.forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+entry.target.id));}}},{rootMargin:'-20% 0px -70% 0px'});sections.forEach(section=>observer.observe(section));}</script>
</body>
</html>`;
}

async function main() {
  const [deckArg, guideArg] = process.argv.slice(2);
  if (!deckArg || !guideArg || process.argv.length !== 4) {
    fail('usage: node render_slide_guide.js DECK.html DECK-guide.md');
  }
  const deck = path.resolve(deckArg);
  const guide = path.resolve(guideArg);
  if (!fs.existsSync(deck)) fail(`deck not found: ${deck}`);
  if (!fs.existsSync(guide)) fail(`guide not found: ${guide}`);

  const stem = path.basename(guide, path.extname(guide));
  const outputDir = path.dirname(guide);
  const captureDir = path.join(outputDir, `${stem}-assets`);
  const htmlPath = path.join(outputDir, `${stem}.html`);
  const pdfPath = path.join(outputDir, `${stem}.pdf`);
  fs.mkdirSync(captureDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(deck).href, { waitUntil: 'load' });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    const titles = await page.locator('section.slide').evaluateAll(slides => slides.map(slide => slide.dataset.title || ''));
    if (!titles.length) fail('no slides found in deck');
    const captures = [];
    for (let index = 0; index < titles.length; index += 1) {
      await page.locator('section.slide').evaluateAll((slides, activeIndex) => {
        slides.forEach((slide, slideIndex) => {
          slide.classList.toggle('active', slideIndex === activeIndex);
          slide.style.display = slideIndex === activeIndex ? 'block' : 'none';
        });
      }, index);
      const filename = `slide-${String(index + 1).padStart(2, '0')}.png`;
      await page.locator('section.slide.active').screenshot({ path: path.join(captureDir, filename) });
      captures.push(`${path.basename(captureDir)}/${filename}`);
    }

    const original = fs.readFileSync(guide, 'utf8');
    const markdown = injectCaptures(original, captures, titles);
    if (/\{\{[^}]+\}\}/.test(markdown)) fail('guide still contains template placeholders');
    fs.writeFileSync(guide, markdown, 'utf8');
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : `${path.basename(deck)} study guide`;
    fs.writeFileSync(htmlPath, guideDocument(markdown, title, `./${path.basename(deck)}`, `./${path.basename(guide)}`), 'utf8');

    const printPage = await browser.newPage();
    await printPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await printPage.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const printDefects = await printPage.evaluate(() => ({
      brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src),
      overflowingTables: [...document.querySelectorAll('.table-wrap')].filter(table => table.scrollWidth > table.clientWidth + 1).length,
    }));
    if (printDefects.brokenImages.length) fail(`guide contains ${printDefects.brokenImages.length} broken image(s)`);
    if (printDefects.overflowingTables) fail(`guide contains ${printDefects.overflowingTables} overflowing table(s)`);
    await printPage.pdf({ path: pdfPath, format: 'A4', preferCSSPageSize: true, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await printPage.close();
    process.stdout.write(`OK: ${guide}\nOK: ${htmlPath}\nOK: ${pdfPath}\nOK: ${captureDir} (${titles.length} captures)\n`);
  } finally {
    await browser.close();
  }
}

main().catch(error => fail(error.stack || error.message));
