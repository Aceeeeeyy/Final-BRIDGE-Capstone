import PDFDocument from 'pdfkit';

// ── Palette ────────────────────────────────────────────────────────────────
// Soft, low-contrast neutrals + three status colors. Kept light so the report
// is easy on the eyes on screen and cheap to print.
const C = {
  brand:  '#053225',
  ink:    '#1f2933',
  body:   '#3e4c59',
  muted:  '#7b8794',
  rule:   '#dde5df',
  panel:  '#f4f8f5',
  track:  '#e6ebe8',
  good:   '#2f9e6b', goodBg: '#e3f4ea',
  warn:   '#c98a12', warnBg: '#fdf3dc',
  bad:    '#d14b43', badBg:  '#fdeceb',
  neutral: '#52606d', neutralBg: '#eef1f3',
};

const PAGE_MARGIN = 50;

// Descriptor colors, ordered best → worst (also controls bar/legend order).
const DESCRIPTORS = [
  { match: /^outstanding/i,           color: '#2f9e6b' },
  { match: /^very satisfactory/i,     color: '#7cc79a' },
  { match: /^satisfactory/i,          color: '#e8c547' },
  { match: /^fairly satisfactory/i,   color: '#f0a04b' },
  { match: /^did not meet/i,          color: '#d14b43' },
];
const descriptorIndex = (name) => {
  const i = DESCRIPTORS.findIndex((d) => d.match.test(name));
  return i === -1 ? DESCRIPTORS.length : i;
};
const descriptorColor = (name) => DESCRIPTORS[descriptorIndex(name)]?.color ?? '#9aa5b1';

// ── Small helpers ──────────────────────────────────────────────────────────
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

function ensureSpace(doc, height) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

/** Removes leftover markdown emphasis markers (we only render a leading bold label). */
function plain(text) {
  return String(text ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Draws a bold lead label followed by wrapping body text that continues on the
 * same line and wraps back to the left edge. Uses pdfkit's first-line `indent`
 * option instead of `continued: true` (which can corrupt the cursor).
 * Returns the height used. With draw=false it only measures.
 */
function leadParagraph(doc, label, rest, x, y, width, { size = 10, color = C.body, labelColor = C.brand, draw = true } = {}) {
  const lineGap = 2.5;
  const lineH = size * 1.2 + lineGap;
  if (!label) {
    doc.font('Helvetica').fontSize(size);
    const h = doc.heightOfString(rest, { width, lineGap });
    if (draw) doc.fillColor(color).text(rest, x, y, { width, lineGap });
    return Math.max(h, lineH);
  }
  doc.font('Helvetica-Bold').fontSize(size);
  const lw = doc.widthOfString(`${label} `);
  doc.font('Helvetica').fontSize(size);
  const h = rest ? doc.heightOfString(rest, { width, indent: lw, lineGap }) : lineH;
  if (draw) {
    doc.font('Helvetica-Bold').fontSize(size).fillColor(labelColor)
      .text(label, x, y, { width, lineBreak: false });
    if (rest) {
      doc.font('Helvetica').fontSize(size).fillColor(color)
        .text(rest, x, y, { width, indent: lw, lineGap });
    }
  }
  return Math.max(h, lineH);
}

/** Splits "**Label:** rest" into { label, rest }. Moves a stray colon onto the label. */
function splitLead(text) {
  const m = String(text).match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (!m) return { label: null, rest: plain(text) };
  let label = m[1].trim();
  let rest = m[2];
  if (rest.startsWith(':')) {
    if (!label.endsWith(':')) label += ':';
    rest = rest.slice(1);
  }
  return { label, rest: plain(rest) };
}

function drawPill(doc, text, x, y, { fg, bg }) {
  doc.font('Helvetica-Bold').fontSize(7.5);
  const w = doc.widthOfString(text) + 14;
  doc.roundedRect(x, y, w, 15, 7.5).fill(bg);
  doc.fillColor(fg).text(text, x + 7, y + 4.2, { width: w, lineBreak: false });
  return w;
}

function sectionLabel(doc, text, x, width, { size = 11, gapTop = 14 } = {}) {
  ensureSpace(doc, gapTop + size + 40);
  doc.y += gapTop;
  const y = doc.y;
  doc.rect(x, y + 1, 3, size + 1).fill(C.brand);
  doc.font('Helvetica-Bold').fontSize(size).fillColor(C.brand)
    .text(text, x + 10, y, { width: width - 10, lineBreak: false });
  doc.y = y + size + 9;
}

// ── Parse the stored plain-text "weakness_summary" back into structured data ─
// (the summary is stored as text so this also works for reports saved before
// this redesign).
export function parseWeaknessSummary(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const find = (re) => {
    for (const l of lines) {
      const m = l.trim().match(re);
      if (m) return m;
    }
    return null;
  };

  const students = find(/^Total students assessed:\s*(\d+)/);
  const avg = find(/^Average class percentage:\s*([\d.]+)%\s*\(median\s*([\d.]+)%,\s*lowest\s*([\d.]+)%,\s*highest\s*([\d.]+)%\)/);
  if (!students || !avg) return null;

  const cutoff = find(/^Mastery cutoff:\s*(\d+)%/);
  const below = find(/^Students below the cutoff \(Learning Gap\):\s*(\d+)\s*\(([\d.]+)%\)/);
  const scope = find(/^Scope:\s*(.*)$/);

  const descriptors = [];
  const items = [];
  const itemRe = /^-\s*Item\s+(\d+)(?:\s+—\s+"(.*)")?:\s*(\d+|n\/a)%?\s+answered correctly\s+\(correct answer:\s*([^)]*)\)\.(?:\s*Most common wrong answer:\s*(.+?)(?:\s+\("(.*)"\))?\s+\((\d+)\s+students?\)\.)?\s*$/;
  const descRe = /^-\s*(.+?):\s*(\d+)\s*student\(s\)\s*$/;

  for (const raw of lines) {
    const l = raw.trim();
    let m = l.match(itemRe);
    if (m) {
      items.push({
        number: Number(m[1]),
        text: m[2] ?? '',
        percent: m[3] === 'n/a' ? null : Number(m[3]),
        correctAnswer: m[4].trim(),
        wrongChoice: m[5] ?? null,
        wrongText: m[6] ?? null,
        wrongCount: m[7] ? Number(m[7]) : null,
      });
      continue;
    }
    m = l.match(descRe);
    if (m && !/answered correctly/i.test(l)) descriptors.push({ name: m[1].trim(), n: Number(m[2]) });
  }

  const scopeText = scope ? scope[1].trim() : '';
  let scopeKind = 'unknown';
  if (/^CLASS-WIDE/i.test(scopeText)) scopeKind = 'class';
  else if (/^SMALL-GROUP/i.test(scopeText)) scopeKind = 'small';
  else if (/^No student/i.test(scopeText)) scopeKind = 'none';
  else if (/^LIMITED EVIDENCE/i.test(scopeText)) scopeKind = 'limited';
  let scopeSentence = scopeText.includes(' — ') ? scopeText.split(' — ').slice(1).join(' — ') : scopeText;
  scopeSentence = scopeSentence ? scopeSentence.charAt(0).toUpperCase() + scopeSentence.slice(1) : '';

  return {
    studentsAssessed: Number(students[1]),
    cutoff: cutoff ? Number(cutoff[1]) : 80,
    belowCount: below ? Number(below[1]) : null,
    belowPct: below ? Number(below[2]) : null,
    average: Number(avg[1]),
    median: Number(avg[2]),
    lowest: Number(avg[3]),
    highest: Number(avg[4]),
    scopeKind,
    scopeSentence,
    descriptors: descriptors.sort((a, b) => descriptorIndex(a.name) - descriptorIndex(b.name)),
    items,
  };
}

// ── Results-at-a-glance components ─────────────────────────────────────────
function drawStatCards(doc, x, width, cards) {
  const gap = 8;
  const h = 58;
  const w = (width - gap * (cards.length - 1)) / cards.length;
  ensureSpace(doc, h + 12);
  const y = doc.y;
  cards.forEach((c, i) => {
    const cx = x + i * (w + gap);
    doc.roundedRect(cx, y, w, h, 6).fill(c.bg || C.panel);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
      .text(c.label.toUpperCase(), cx + 10, y + 9, { width: w - 16, lineBreak: false, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(18).fillColor(c.color || C.ink)
      .text(c.value, cx + 10, y + 21, { width: w - 16, lineBreak: false });
    if (c.sub) {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
        .text(c.sub, cx + 10, y + 44, { width: w - 16, lineBreak: false });
    }
  });
  doc.y = y + h + 12;
}

function drawDescriptorBar(doc, x, width, descriptors) {
  const total = descriptors.reduce((s, d) => s + d.n, 0);
  if (!total) return;
  ensureSpace(doc, 50);
  const y = doc.y;
  const h = 10;

  doc.save();
  doc.roundedRect(x, y, width, h, 5).clip();
  let cx = x;
  descriptors.forEach((d) => {
    const w = (width * d.n) / total;
    doc.rect(cx, y, w, h).fill(descriptorColor(d.name));
    cx += w;
  });
  doc.restore();

  let lx = x;
  let ly = y + h + 9;
  doc.font('Helvetica').fontSize(8);
  descriptors.forEach((d) => {
    const label = `${d.name} (${d.n})`;
    const tw = doc.widthOfString(label);
    if (lx + 11 + tw > x + width) { lx = x; ly += 13; }
    doc.circle(lx + 3, ly + 4, 3).fill(descriptorColor(d.name));
    doc.fillColor(C.body).text(label, lx + 11, ly, { lineBreak: false });
    lx += 11 + tw + 16;
  });
  doc.y = ly + 18;
}

function barColor(pct, cutoff) {
  if (pct == null) return C.muted;
  if (pct >= cutoff) return C.good;
  if (pct >= cutoff - 20) return C.warn;
  return C.bad;
}

function drawItemTable(doc, x, width, items, cutoff) {
  const colItem = 34;
  const colQ = 200;
  const colBar = 112;
  const colWrong = width - colItem - colQ - colBar;
  const rowH = 15.5;

  const header = () => {
    ensureSpace(doc, rowH * 3);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted);
    doc.text('ITEM', x + 6, y, { width: colItem, lineBreak: false, characterSpacing: 0.5 });
    doc.text('QUESTION', x + colItem, y, { width: colQ - 8, lineBreak: false, characterSpacing: 0.5 });
    doc.text('CORRECT', x + colItem + colQ, y, { width: colBar, lineBreak: false, characterSpacing: 0.5 });
    doc.text('COMMON WRONG ANSWER', x + colItem + colQ + colBar, y, { width: colWrong, lineBreak: false, characterSpacing: 0.5 });
    doc.moveTo(x, y + 12).lineTo(x + width, y + 12).lineWidth(0.6).strokeColor(C.rule).stroke();
    doc.y = y + 16;
  };

  header();
  items.forEach((it, i) => {
    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (i % 2 === 0) doc.rect(x, y, width, rowH).fill('#f8faf9');
    const ty = y + 3.8;

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.brand)
      .text(String(it.number), x + 6, ty, { width: colItem - 6, lineBreak: false });

    doc.font('Helvetica').fontSize(8.5).fillColor(C.body)
      .text(plain(it.text) || '—', x + colItem, ty, { width: colQ - 12, height: rowH - 2, ellipsis: true });

    const color = barColor(it.percent, cutoff);
    const trackW = 62;
    const bx = x + colItem + colQ;
    doc.roundedRect(bx, y + 4.8, trackW, 6, 3).fill(C.track);
    if (it.percent != null && it.percent > 0) {
      doc.roundedRect(bx, y + 4.8, Math.max(4, (trackW * it.percent) / 100), 6, 3).fill(color);
    }
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(color)
      .text(it.percent == null ? 'n/a' : `${it.percent}%`, bx + trackW + 8, ty, { width: 34, lineBreak: false });

    let wrong = '—';
    if (it.wrongChoice) {
      wrong = it.wrongText
        ? `${it.wrongChoice} — ${plain(it.wrongText)}  (${it.wrongCount})`
        : `${it.wrongChoice}  (${it.wrongCount})`;
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(it.wrongChoice ? C.body : C.muted)
      .text(wrong, x + colItem + colQ + colBar, ty, { width: colWrong - 4, height: rowH - 2, ellipsis: true });

    doc.y = y + rowH;
  });
  doc.y += 6;
}

// ── Recommendation markdown → scannable blocks ─────────────────────────────
function tokenize(markdown) {
  const tokens = [];
  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const depth = Math.min(2, Math.floor((raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length) / 2));
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#{1,2}\s+(.*)$/))) tokens.push({ t: 'h2', text: plain(m[1]) });
    else if ((m = line.match(/^#{3,6}\s+(.*)$/))) tokens.push({ t: 'h3', text: plain(m[1]) });
    else if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) tokens.push({ t: 'num', n: m[1], text: m[2], depth: 0 });
    else if ((m = line.match(/^[-*•]\s+(.*)$/))) tokens.push({ t: 'bullet', text: m[1], depth: depth > 0 ? 1 : 0 });
    else if (/^[-*_]{3,}$/.test(line)) continue;
    else tokens.push({ t: 'p', text: line });
  }
  return tokens;
}

function itemMetrics(item, x, width) {
  const indent = (item.depth || 0) * 14;
  if (item.t === 'p') {
    return { x: x + indent, width: width - indent, markerW: 0 };
  }
  const markerW = item.t === 'num' ? 18 : 14;
  return { x: x + indent, width: width - indent, markerW };
}

function itemHeight(doc, item, x, width) {
  const mt = itemMetrics(item, x, width);
  const { label, rest } = splitLead(item.text);
  return leadParagraph(doc, label, rest, mt.x + mt.markerW, 0, mt.width - mt.markerW, { draw: false });
}

function drawItem(doc, item, x, width) {
  const mt = itemMetrics(item, x, width);
  const { label, rest } = splitLead(item.text);
  const y = doc.y;
  if (item.t === 'bullet') {
    doc.circle(mt.x + 4, y + 5.4, item.depth ? 1.3 : 1.8).fill(item.depth ? C.muted : C.brand);
  } else if (item.t === 'num') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.brand)
      .text(`${item.n}.`, mt.x, y, { width: mt.markerW, lineBreak: false });
  }
  const h = leadParagraph(doc, label, rest, mt.x + mt.markerW, y, mt.width - mt.markerW, {});
  doc.y = y + h + 3.5;
}

function renderRecommendation(doc, markdown, x, width) {
  const tokens = tokenize(markdown);
  const usable = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  let i = 0;

  while (i < tokens.length) {
    const tk = tokens[i];

    if (tk.t === 'h2') {
      sectionLabel(doc, tk.text, x, width, { size: 11.5, gapTop: 12 });
      i += 1;
      continue;
    }

    if (tk.t === 'h3') {
      // Gather the strategy "card": a title plus everything up to the next heading.
      const body = [];
      let j = i + 1;
      while (j < tokens.length && tokens[j].t !== 'h2' && tokens[j].t !== 'h3') {
        body.push(tokens[j]);
        j += 1;
      }
      const pad = 11;
      const innerX = x + pad + 4;
      const innerW = width - pad * 2 - 4;

      doc.font('Helvetica-Bold').fontSize(10.5);
      const titleH = doc.heightOfString(tk.text, { width: innerW });
      const bodyH = body.reduce((s, it) => s + itemHeight(doc, it, innerX, innerW) + 3.5, 0);
      const total = pad + titleH + 6 + bodyH + pad - 3;

      if (total < usable - 20) {
        ensureSpace(doc, total + 8);
        const y = doc.y;
        doc.roundedRect(x, y, width, total, 6).fill(C.panel);
        doc.rect(x, y + 6, 3, total - 12).fill(C.brand);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.brand)
          .text(tk.text, innerX, y + pad, { width: innerW });
        doc.y = y + pad + titleH + 6;
        body.forEach((it) => drawItem(doc, it, innerX, innerW));
        doc.y = y + total + 9;
      } else {
        // Too tall for one page — flow it plainly and let it break between items.
        ensureSpace(doc, titleH + 40);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.brand)
          .text(tk.text, x, doc.y, { width });
        doc.y += 4;
        body.forEach((it) => {
          ensureSpace(doc, itemHeight(doc, it, x, width) + 4);
          drawItem(doc, it, x, width);
        });
        doc.y += 6;
      }
      i = j;
      continue;
    }

    ensureSpace(doc, itemHeight(doc, tk, x, width) + 4);
    drawItem(doc, tk, x, width);
    i += 1;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Builds a PDF report of AI Interventions for a set of assessments.
 *
 * @param {object} opts
 * @param {{ name: string, schoolName: string }} opts.teacher
 * @param {Array<{
 *   assessment: { assessment_title, assessment_type, term, total_items, created_at },
 *   interventions: Array<{
 *     competencyName: string,
 *     weakness_summary: string,
 *     ai_recommendation: string,
 *     final_recommendation?: string,
 *     review_status?: string,
 *     ai_provider: string,
 *     ai_model: string,
 *     created_at: string,
 *   }>
 * }>} opts.assessments
 * @returns {PDFDocument} an unended pdfkit document — caller pipes it and calls .end()
 */
export function buildInterventionsPdf({ teacher, assessments }) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ── Cover / header block ────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.brand)
    .text('AI Intervention Report', x, doc.y, { width });
  doc.moveDown(0.25);
  const prepared = `Prepared by ${teacher.name}${teacher.schoolName ? `  ·  ${teacher.schoolName}` : ''}`;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted)
    .text(prepared, x, doc.y, { width });
  doc.text(`Generated ${formatDateTime(new Date().toISOString())}  ·  ${assessments.length} assessment${assessments.length === 1 ? '' : 's'}`, x, doc.y, { width });
  doc.moveDown(0.7);
  doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.8).strokeColor(C.rule).stroke();
  doc.moveDown(0.8);

  assessments.forEach(({ assessment, interventions }, idx) => {
    if (idx > 0) doc.addPage();

    doc.font('Helvetica-Bold').fontSize(15).fillColor(C.ink)
      .text(assessment.assessment_title, x, doc.y, { width });
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text(
        `${assessment.assessment_type}  ·  ${assessment.term}  ·  ${assessment.total_items} items  ·  Created ${formatDateTime(assessment.created_at)}`,
        x, doc.y + 2, { width },
      );
    doc.moveDown(0.8);

    if (!interventions.length) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(C.muted)
        .text('No accepted AI intervention for this assessment yet.', x, doc.y, { width });
      return;
    }

    interventions.forEach((iv, i) => {
      if (i > 0) doc.addPage();
      else ensureSpace(doc, 260);

      const reviewStatus = iv.review_status || 'Pending Review';
      const data = parseWeaknessSummary(iv.weakness_summary);

      // Competency heading + status pills
      doc.font('Helvetica-Bold').fontSize(13).fillColor(C.brand)
        .text(iv.competencyName, x, doc.y, { width });
      doc.y += 6;
      let px = x;
      const py = doc.y;
      const scopePill = {
        class:   { text: 'CLASS-WIDE GAP',    fg: C.bad,     bg: C.badBg },
        small:   { text: 'SMALL-GROUP GAP',   fg: C.warn,    bg: C.warnBg },
        none:    { text: 'NO GAP FOUND',      fg: C.good,    bg: C.goodBg },
        limited: { text: 'LIMITED EVIDENCE',  fg: C.neutral, bg: C.neutralBg },
      }[data?.scopeKind];
      if (scopePill) px += drawPill(doc, scopePill.text, px, py, scopePill) + 6;
      const reviewPill = {
        'Accepted':       { text: 'TEACHER ACCEPTED', fg: C.good, bg: C.goodBg },
        'Edited':         { text: 'TEACHER EDITED',   fg: C.good, bg: C.goodBg },
        'Rejected':       { text: 'REJECTED',         fg: C.bad,  bg: C.badBg },
        'Pending Review': { text: 'PENDING REVIEW',   fg: C.warn, bg: C.warnBg },
      }[reviewStatus] || { text: reviewStatus.toUpperCase(), fg: C.neutral, bg: C.neutralBg };
      drawPill(doc, reviewPill.text, px, py, reviewPill);
      doc.y = py + 21;

      doc.font('Helvetica').fontSize(8).fillColor(C.muted)
        .text(
          `Generated ${formatDateTime(iv.created_at)}${iv.ai_provider ? `  ·  ${iv.ai_provider} (${iv.ai_model})` : ''}`,
          x, doc.y, { width },
        );
      doc.y += 4;

      if (reviewStatus === 'Rejected') {
        const msg = 'This AI recommendation was reviewed and rejected by the teacher. It is shown for record-keeping only and should not be used as the basis for an intervention.';
        doc.font('Helvetica-Oblique').fontSize(9);
        const mh = doc.heightOfString(msg, { width: width - 20 });
        ensureSpace(doc, mh + 24);
        const my = doc.y + 4;
        doc.roundedRect(x, my, width, mh + 14, 6).fill(C.badBg);
        doc.fillColor(C.bad).text(msg, x + 10, my + 7, { width: width - 20 });
        doc.y = my + mh + 20;
      }

      // ── Class results at a glance ─────────────────────────────────────────
      if (data) {
        sectionLabel(doc, 'Class results at a glance', x, width);
        if (data.scopeSentence) {
          doc.font('Helvetica').fontSize(10).fillColor(C.body)
            .text(data.scopeSentence, x, doc.y, { width, lineGap: 2 });
          doc.y += 8;
        }

        const belowBad = data.belowCount != null && data.belowCount > 0;
        drawStatCards(doc, x, width, [
          { label: 'Students assessed', value: String(data.studentsAssessed) },
          {
            label: `Below ${data.cutoff}% cutoff`,
            value: data.belowCount != null ? String(data.belowCount) : 'n/a',
            sub: data.belowPct != null ? `${data.belowPct}% of the class` : 'insufficient evidence',
            color: belowBad ? C.bad : C.good,
            bg: belowBad ? C.badBg : C.goodBg,
          },
          {
            label: 'Class average',
            value: `${data.average}%`,
            sub: `median ${data.median}%`,
            color: barColor(data.average, data.cutoff),
          },
          { label: 'Score range', value: `${data.lowest}–${data.highest}%`, sub: 'lowest to highest' },
        ]);

        drawDescriptorBar(doc, x, width, data.descriptors);

        // ── Item-by-item ──────────────────────────────────────────────────
        if (data.items.length) {
          sectionLabel(doc, 'Item-by-item results', x, width);

          const scored = data.items.filter((it) => it.percent != null);
          if (scored.length) {
            const min = Math.min(...scored.map((it) => it.percent));
            const hardest = scored.filter((it) => it.percent === min).map((it) => it.number);
            const shown = hardest.slice(0, 8).join(', ') + (hardest.length > 8 ? ', …' : '');
            const h = leadParagraph(doc, 'Lowest-scoring:', `Item${hardest.length > 1 ? 's' : ''} ${shown} (${min}% correct)`, x, doc.y, width, { size: 9.5, labelColor: C.bad });
            doc.y += h + 8;
          }
          drawItemTable(doc, x, width, data.items, data.cutoff);
        }
      } else if (iv.weakness_summary) {
        // Older/unrecognised format — fall back to a quiet, readable block.
        sectionLabel(doc, 'Class results', x, width);
        doc.font('Helvetica').fontSize(8.5).fillColor(C.body)
          .text(iv.weakness_summary, x, doc.y, { width, lineGap: 2 });
        doc.y += 8;
      }

      // ── Recommendation ────────────────────────────────────────────────────
      ensureSpace(doc, 140);
      sectionLabel(
        doc,
        reviewStatus === 'Edited' ? 'Recommended actions (teacher-edited final version)' : 'Recommended actions',
        x, width, { size: 13, gapTop: 18 },
      );
      // Prefer the teacher's edited final wording when it exists.
      renderRecommendation(doc, iv.final_recommendation || iv.ai_recommendation, x, width);
    });
  });

  // ── Page footers ──────────────────────────────────────────────────────────
  // The footer sits inside the bottom margin on purpose. pdfkit's text()
  // auto-adds a page when y passes `margins.bottom`, which silently appended a
  // blank page after every page. Zeroing the bottom margin just for these calls
  // stops that from firing.
  const pageCount = doc.bufferedPageRange().count;
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(p);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
    doc.text('BRIDGE · AI Intervention Report', x, doc.page.height - 36, { width: width / 2, align: 'left', lineBreak: false });
    doc.text(`Page ${p + 1} of ${pageCount}`, x + width / 2, doc.page.height - 36, { width: width / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = originalBottomMargin;
  }

  return doc;
}
