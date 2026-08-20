// Our Home -- renders a submitted application into a formal, letterhead-style
// PDF using pdf-lib (pure JS, no native deps -- works fine in the Workers
// runtime). Generated once at submission time (see routes/apply.js) and
// stored in R2; the admin dashboard's "Download PDF" just serves that file.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_SIZE = [612, 792]; // US Letter, points
const MARGIN = 54;
const LINE_HEIGHT = 16;
const HEADING_GAP = 10;
const FOOTER_HEIGHT = 34; // reserved space at the bottom of every page

const NAVY = rgb(0.043, 0.208, 0.314); // #0b3550 -- Our Home / Black & Associates navy
const MUTED = rgb(0.36, 0.4, 0.44);
const INK = rgb(0.12, 0.14, 0.16);
const LINE_GRAY = rgb(0.8, 0.8, 0.8);
const LOGO_PATH = '/assets/images/ba-logo-full.png';

function section(title, rows) {
  return { title, rows: rows.filter(([, v]) => v !== null && v !== undefined && v !== '') };
}

function buildSections(row) {
  const yesNo = (v) => (v === null || v === undefined || v === '' ? '' : v);

  return [
    section('Applicant Information', [
      ['Full name', row.full_name],
      ['Email', row.email],
      ['Phone', row.phone],
      ['Address', [row.address_street, row.address_city, row.address_state, row.address_zip].filter(Boolean).join(', ')],
    ]),
    section('Position', [
      ['Position applied for', row.position],
      ['Employment type', row.employment_type],
      ['Available start date', row.start_date],
      ['How did you hear about us', row.referral_source],
    ]),
    section('Availability', [
      ['Days available', row.days_available],
      ['Shift preference', row.shift_preference],
      ['Hours desired per week', row.hours_desired],
      ['Willing to work overnight shifts', yesNo(row.overnight_ok)],
    ]),
    section('Employment Eligibility', [
      ['At least 18 years old', yesNo(row.age_eligible)],
      ['Authorized to work in the U.S.', yesNo(row.work_authorized)],
      ['Valid driver\'s license', yesNo(row.drivers_license)],
      ['Consents to background check', yesNo(row.background_check_consent)],
    ]),
    section('Education & Certifications', [
      ['Highest education level', row.education_level],
      ['School name', row.school_name],
      ['Certifications', row.certifications],
      ['Experience working with children', row.child_experience],
    ]),
    section('Employment History -- Employer 1', [
      ['Employer', row.employer1_name],
      ['Title', row.employer1_title],
      ['From', row.employer1_from],
      ['To', row.employer1_to],
      ['Supervisor', row.employer1_supervisor],
      ['Reason for leaving', row.employer1_reason],
    ]),
    section('Employment History -- Employer 2', [
      ['Employer', row.employer2_name],
      ['Title', row.employer2_title],
      ['From', row.employer2_from],
      ['To', row.employer2_to],
      ['Supervisor', row.employer2_supervisor],
      ['Reason for leaving', row.employer2_reason],
    ]),
    section('References', [
      ['Reference 1', [row.reference1_name, row.reference1_relationship, row.reference1_phone, row.reference1_email].filter(Boolean).join(' -- ')],
      ['Reference 2', [row.reference2_name, row.reference2_relationship, row.reference2_phone, row.reference2_email].filter(Boolean).join(' -- ')],
    ]),
    section('Certification', [
      ['Signature', row.signature],
      ['Date', row.signature_date],
    ]),
  ].filter((s) => s.rows.length > 0);
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function loadLogoBytes(ctx) {
  const { env, request } = ctx || {};
  if (!env || !env.ASSETS || !request) return null;
  try {
    const logoUrl = new URL(LOGO_PATH, request.url);
    const resp = await env.ASSETS.fetch(new Request(logoUrl));
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

export async function generateApplicationPdf(row, ctx = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImage = null;
  const logoBytes = await loadLogoBytes(ctx);
  if (logoBytes) {
    try {
      logoImage = await pdf.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }
  }

  const pages = [];
  let page = pdf.addPage(PAGE_SIZE);
  pages.push(page);
  let y;
  const contentWidth = PAGE_SIZE[0] - MARGIN * 2;
  const labelWidth = 190;

  function drawLetterhead() {
    const topY = PAGE_SIZE[1] - MARGIN;
    let textX = MARGIN;
    let blockBottom = topY - 30;

    if (logoImage) {
      const logoHeight = 42;
      const scale = logoHeight / logoImage.height;
      const logoWidth = logoImage.width * scale;
      page.drawImage(logoImage, { x: MARGIN, y: topY - logoHeight, width: logoWidth, height: logoHeight });
      textX = MARGIN + logoWidth + 16;
      blockBottom = Math.min(blockBottom, topY - logoHeight);
    }

    page.drawText('OFFICIAL EMPLOYMENT APPLICATION', { x: textX, y: topY - 14, size: 12.5, font: bold, color: NAVY });
    page.drawText('Our Home -- A Program of Black & Associates Global, Inc.', {
      x: textX, y: topY - 29, size: 9, font, color: MUTED,
    });

    const ruleY = blockBottom - 10;
    page.drawLine({
      start: { x: MARGIN, y: ruleY },
      end: { x: PAGE_SIZE[0] - MARGIN, y: ruleY },
      thickness: 2,
      color: NAVY,
    });
    y = ruleY - 20;
  }

  function drawContinuationHeader() {
    const topY = PAGE_SIZE[1] - MARGIN;
    page.drawText('OFFICIAL EMPLOYMENT APPLICATION -- OUR HOME', { x: MARGIN, y: topY, size: 8.5, font: bold, color: NAVY });
    const ruleY = topY - 8;
    page.drawLine({
      start: { x: MARGIN, y: ruleY },
      end: { x: PAGE_SIZE[0] - MARGIN, y: ruleY },
      thickness: 1,
      color: LINE_GRAY,
    });
    y = ruleY - 22;
  }

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN + FOOTER_HEIGHT) {
      page = pdf.addPage(PAGE_SIZE);
      pages.push(page);
      drawContinuationHeader();
    }
  }

  function drawSubtitle(text) {
    newPageIfNeeded(20);
    page.drawText(text, { x: MARGIN, y, size: 10.5, font, color: MUTED });
    y -= 24;
  }

  function drawSectionHeading(text) {
    newPageIfNeeded(LINE_HEIGHT + HEADING_GAP + 6);
    y -= HEADING_GAP;
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 12, font: bold, color: NAVY });
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_SIZE[0] - MARGIN, y: y - 2 },
      thickness: 0.75,
      color: LINE_GRAY,
    });
    y -= LINE_HEIGHT;
  }

  function drawRow(label, value) {
    const valueLines = wrapText(String(value), font, 10.5, contentWidth - labelWidth);
    const rowHeight = Math.max(valueLines.length, 1) * LINE_HEIGHT;
    newPageIfNeeded(rowHeight);

    page.drawText(label, { x: MARGIN, y, size: 10.5, font: bold, color: rgb(0.25, 0.25, 0.25) });
    valueLines.forEach((line, i) => {
      page.drawText(line, {
        x: MARGIN + labelWidth,
        y: y - i * LINE_HEIGHT,
        size: 10.5,
        font,
        color: INK,
      });
    });
    y -= rowHeight;
  }

  drawLetterhead();
  drawSubtitle(`Submitted ${row.submitted_at || ''}${row.id ? `  --  Application #${row.id}` : ''}`);

  for (const { title, rows } of buildSections(row)) {
    drawSectionHeading(title);
    for (const [label, value] of rows) {
      drawRow(label, value);
    }
  }

  // Footer pass -- page numbers + a thin navy rule, once the final page
  // count is known.
  const total = pages.length;
  pages.forEach((p, i) => {
    const footerY = MARGIN - 10;
    p.drawLine({
      start: { x: MARGIN, y: footerY + 16 },
      end: { x: PAGE_SIZE[0] - MARGIN, y: footerY + 16 },
      thickness: 1,
      color: NAVY,
    });
    p.drawText('Our Home -- Official Employment Application', { x: MARGIN, y: footerY, size: 8, font, color: MUTED });
    const pageLabel = `Page ${i + 1} of ${total}`;
    const labelSize = font.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, { x: PAGE_SIZE[0] - MARGIN - labelSize, y: footerY, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
