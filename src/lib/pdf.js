// Our Home -- renders a submitted application into a simple, readable PDF
// using pdf-lib (pure JS, no native deps -- works fine in the Workers runtime).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_SIZE = [612, 792]; // US Letter, points
const MARGIN = 54;
const LINE_HEIGHT = 16;
const HEADING_GAP = 10;

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

export async function generateApplicationPdf(row) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;
  const contentWidth = PAGE_SIZE[0] - MARGIN * 2;
  const labelWidth = 190;

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN) {
      page = pdf.addPage(PAGE_SIZE);
      y = PAGE_SIZE[1] - MARGIN;
    }
  }

  function drawTitle(text) {
    newPageIfNeeded(28);
    page.drawText(text, { x: MARGIN, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 28;
  }

  function drawSubtitle(text) {
    newPageIfNeeded(20);
    page.drawText(text, { x: MARGIN, y, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
    y -= 20;
  }

  function drawSectionHeading(text) {
    newPageIfNeeded(LINE_HEIGHT + HEADING_GAP + 6);
    y -= HEADING_GAP;
    page.drawText(text, { x: MARGIN, y, size: 13, font: bold, color: rgb(0.05, 0.35, 0.3) });
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_SIZE[0] - MARGIN, y: y - 2 },
      thickness: 0.75,
      color: rgb(0.8, 0.8, 0.8),
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
        color: rgb(0.1, 0.1, 0.1),
      });
    });
    y -= rowHeight;
  }

  drawTitle('Our Home -- Employment Application');
  drawSubtitle(`Submitted ${row.submitted_at || ''}${row.id ? `  --  Application #${row.id}` : ''}`);

  for (const { title, rows } of buildSections(row)) {
    drawSectionHeading(title);
    for (const [label, value] of rows) {
      drawRow(label, value);
    }
  }

  return pdf.save();
}
