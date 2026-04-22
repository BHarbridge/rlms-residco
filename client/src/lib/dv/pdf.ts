/* ------------------------------------------------------------------
 * Rule 107 DV — client-side PDF generator
 *
 * Builds a single-page US Letter PDF summary from a DvResult + metadata.
 * Used by the in-page "Share" button (Web Share API) so the worksheet can
 * be emailed / messaged / AirDropped directly from a phone, and also works
 * as a download fallback on desktop.
 * ------------------------------------------------------------------ */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtUsd, fmtPct, fmtDate, quarterLabel } from "./format";
import type { DvResult } from "./types";

export interface PdfMeta {
  carInitial?: string | null;
  carNumber?: string | null;
  railroad?: string | null;
  ddctIncidentNo?: string | null;
  incidentDate?: string | null;
  incidentLocation?: string | null;
  calcId?: number | null;
  tareWeightLb?: number | null;
}

/** Smart filename like `Rule107-DV_RESI12345_DDCT-2024-0042.pdf` */
export function buildPdfFilename(meta: PdfMeta): string {
  const car = `${meta.carInitial || ""}${meta.carNumber || ""}`.trim() || (meta.calcId ? `calc-${meta.calcId}` : "worksheet");
  const ddct = meta.ddctIncidentNo || (meta.calcId ? String(meta.calcId) : "preview");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Rule107-DV_${safe(car)}_DDCT-${safe(ddct)}.pdf`;
}

/** Generates a jsPDF doc and returns it + the filename. */
export function buildCalculationPdfDoc(r: DvResult, meta: PdfMeta): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let y = 44;

  // ---- Metadata block (right-aligned, drawn FIRST so we know its height
  // and can place the brand strip below or beside it)
  doc.setFontSize(9);
  doc.setTextColor(40);
  const carLine = `${meta.carInitial || "-"} ${meta.carNumber || ""}`.trim();
  const metaLines = [
    { label: "Car", value: carLine || "-" },
    { label: "Railroad", value: meta.railroad || "-" },
    { label: "DDCT / Incident", value: meta.ddctIncidentNo || "-" },
    {
      label: "Incident",
      value: `${meta.incidentDate ? fmtDate(meta.incidentDate) : "-"}${meta.incidentLocation ? ` · ${meta.incidentLocation}` : ""}`,
    },
    { label: "Generated", value: new Date().toLocaleString() },
  ];

  // ---- Header brand strip (left side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text("AAR Rule 107 · Depreciated Value Calculation", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("Office Manual Rule 107.E · Settlement Worksheet", marginX, y);

  // Orange accent bar (brand hint)
  doc.setDrawColor(217, 119, 6); // amber-600
  doc.setLineWidth(2);
  doc.line(marginX, y + 6, marginX + 48, y + 6);

  doc.setFontSize(9);
  // Right-side metadata starts lower so it sits beside the subtitle, not the title
  let metaY = 58;
  metaLines.forEach((m) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    const labelText = `${m.label}: `;
    const labelW = doc.getTextWidth(labelText);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    const valueW = doc.getTextWidth(m.value);
    const totalW = labelW + valueW;
    const x = pageW - marginX - totalW;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(labelText, x, metaY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(m.value, x + labelW, metaY);
    metaY += 11;
  });

  // Reserve space for the tallest of (brand + accent bar) vs (metadata block)
  const metaBlockBottom = 58 + metaLines.length * 11;
  y = Math.max(y + 12, metaBlockBottom + 10);

  // ---- Headline KPIs (2x2 grid)
  const kpis: Array<{ label: string; value: string; emphasize?: boolean }> = [
    { label: "Depreciated Value", value: fmtUsd(r.totalDepreciatedValue, { showZero: true }), emphasize: true },
    { label: "Salvage + 20%", value: fmtUsd(r.salvage.salvagePlus20, { showZero: true }) },
    { label: "Total Reproduction", value: fmtUsd(r.totalReproductionCost, { showZero: true }) },
    { label: "Salvage Value", value: fmtUsd(r.salvage.totalSalvage, { showZero: true }) },
  ];
  const colW = (pageW - marginX * 2) / 2;
  const kpiRowH = 44;
  kpis.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const ky = y + row * kpiRowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(k.label.toUpperCase(), x, ky + 10, { charSpace: 0.6 });
    doc.setFont("courier", "bold");
    doc.setFontSize(k.emphasize ? 16 : 13);
    doc.setTextColor(k.emphasize ? 217 : 30, k.emphasize ? 119 : 30, k.emphasize ? 6 : 30);
    doc.text(k.value, x, ky + 30);
  });
  y += kpiRowH * 2 + 6;

  // ---- Context grid (two columns of key/value rows)
  const ctx: Array<[string, string]> = [
    ["Age", `${r.ageYears}y ${r.ageMonths}m (${r.ageTotalYearsDecimal.toFixed(2)})`],
    ["Salvage Quarter", quarterLabel(r.quarterCode)],
    ["Cost Factor (build)", String(r.costFactorBuildYear)],
    ["Cost Factor (prior)", `${r.costFactorPriorToDamageYear} · ${r.priorYear}`],
    ["Age Cutoff", `${r.ageCutoffYears} years`],
    ["Dismantling Allowance", fmtUsd(r.salvage.dismantlingAllowance, { showZero: true })],
  ];
  doc.setFontSize(9);
  const ctxColW = (pageW - marginX * 2) / 2;
  ctx.forEach((pair, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = marginX + col * ctxColW;
    const cy = y + row * 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(pair[0], cx, cy);
    doc.setFont("courier", "normal");
    doc.setTextColor(30);
    const valW = doc.getTextWidth(pair[1]);
    doc.text(pair[1], cx + ctxColW - valW - 8, cy);
  });
  y += Math.ceil(ctx.length / 2) * 14 + 12;

  // ---- Reproduction & Depreciation table
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, lineColor: [220, 220, 220], lineWidth: 0.5 },
    headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: "bold", fontSize: 8 },
    head: [["Line", "Basis", "Repro", "Dep %", "DV"]],
    body: [
      [
        r.base.label,
        r.base.yearOrMonthBasis,
        fmtUsd(r.base.reproductionCost, { showZero: true }),
        fmtPct(r.base.depreciationRate),
        fmtUsd(r.base.depreciatedValue, { showZero: true }),
      ],
      ...r.abItems.map((ab) => [
        ab.label,
        ab.yearOrMonthBasis,
        fmtUsd(ab.reproductionCost, { showZero: true }),
        fmtPct(ab.depreciationRate),
        fmtUsd(ab.depreciatedValue, { showZero: true }),
      ]),
    ],
    columnStyles: {
      0: { cellWidth: 140 },
      1: { cellWidth: 90, font: "courier", fontSize: 8, textColor: [100, 100, 100] },
      2: { halign: "right", font: "courier" },
      3: { halign: "right", font: "courier" },
      4: { halign: "right", font: "courier", fontStyle: "bold" },
    },
    didDrawPage: () => {},
  });
  // @ts-expect-error autotable adds lastAutoTable to doc
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // ---- Rule 108 summary line
  const owner108 = r.salvage.totalSalvage - r.salvage.dismantlingAllowance;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text("RULE 108 · DISMANTLED CAR (for comparison)", marginX, y);
  y += 4;
  doc.setDrawColor(230);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 12;
  const r108: Array<[string, string]> = [
    ["Salvage Value", fmtUsd(r.salvage.totalSalvage, { showZero: true })],
    ["Dismantling Allowance", fmtUsd(r.salvage.dismantlingAllowance, { showZero: true })],
    ["Owner Entitled (SV - Dismantling)", fmtUsd(owner108, { showZero: true })],
  ];
  const r108ColW = (pageW - marginX * 2) / 3;
  r108.forEach((pair, i) => {
    const cx = marginX + i * r108ColW;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    // splitTextToSize guarantees the label stays within the column width
    const labelLines = doc.splitTextToSize(pair[0].toUpperCase(), r108ColW - 8);
    doc.text(labelLines, cx, y, { charSpace: 0.3 });
    doc.setFont("courier", "bold");
    doc.setFontSize(12);
    doc.setTextColor(i === 2 ? 217 : 30, i === 2 ? 119 : 30, i === 2 ? 6 : 30);
    doc.text(pair[1], cx, y + 15);
  });
  y += 36;

  // ---- Settlement matrix
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4.5, lineColor: [220, 220, 220], lineWidth: 0.5 },
    headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: "bold", fontSize: 8 },
    head: [["Condition", "DV", "SV", "SV + 20%"]],
    body: [
      [
        "A · Handling Line Possession",
        fmtUsd(r.settlementMatrix.handlingLine.dv, { showZero: true }),
        fmtUsd(r.settlementMatrix.handlingLine.sv, { showZero: true }),
        fmtUsd(r.settlementMatrix.handlingLine.svPlus20, { showZero: true }),
      ],
      [
        "B · Owner, Repaired (offered)",
        fmtUsd(r.settlementMatrix.ownerRepairedOffered.dv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerRepairedOffered.sv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerRepairedOffered.svPlus20, { showZero: true }),
      ],
      [
        "B · Owner, Repaired (not offered)",
        fmtUsd(r.settlementMatrix.ownerRepairedNotOffered.dv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerRepairedNotOffered.sv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerRepairedNotOffered.svPlus20, { showZero: true }),
      ],
      [
        "C · Owner, Dismantled (offered)",
        fmtUsd(r.settlementMatrix.ownerDismantledOffered.dv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerDismantledOffered.sv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerDismantledOffered.svPlus20, { showZero: true }),
      ],
      [
        "C · Owner, Dismantled (not offered)",
        fmtUsd(r.settlementMatrix.ownerDismantledNotOffered.dv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerDismantledNotOffered.sv, { showZero: true }),
        fmtUsd(r.settlementMatrix.ownerDismantledNotOffered.svPlus20, { showZero: true }),
      ],
    ],
    columnStyles: {
      0: { cellWidth: 220 },
      1: { halign: "right", font: "courier" },
      2: { halign: "right", font: "courier" },
      3: { halign: "right", font: "courier" },
    },
  });
  // @ts-expect-error autotable adds lastAutoTable to doc
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // ---- Warnings (if any)
  if (r.warnings && r.warnings.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(180, 40, 40);
    doc.text("NOTES", marginX, y);
    y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    r.warnings.forEach((w) => {
      const lines = doc.splitTextToSize(`• ${w}`, pageW - marginX * 2);
      doc.text(lines, marginX, y);
      y += lines.length * 10;
    });
    y += 4;
  }

  // ---- Footer citation
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setDrawColor(230);
  doc.setLineWidth(0.5);
  doc.line(marginX, footerY - 10, pageW - marginX, footerY - 10);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  const footerText =
    "Computed per AAR Office Manual Rule 107.E. Cost factors from Exhibit II; salvage factors from Exhibit IV; A&B codes from Exhibit V. Worksheet provided for settlement discussion; refer to the current AAR Office Manual for authoritative text.";
  const footerLines = doc.splitTextToSize(footerText, pageW - marginX * 2);
  doc.text(footerLines, marginX, footerY);

  return { doc, filename: buildPdfFilename(meta) };
}

/** Builds a PDF File ready for `navigator.share({ files: [...] })`. */
export function buildCalculationPdfFile(r: DvResult, meta: PdfMeta): { file: File; filename: string } {
  const { doc, filename } = buildCalculationPdfDoc(r, meta);
  const blob = doc.output("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  return { file, filename };
}

/** Triggers a direct download (used as a fallback when Web Share is unavailable). */
export function downloadCalculationPdf(r: DvResult, meta: PdfMeta): void {
  const { doc, filename } = buildCalculationPdfDoc(r, meta);
  doc.save(filename);
}

/** True if the browser supports sharing File objects via the Web Share API. */
export function canNativeShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!("share" in navigator) || !("canShare" in navigator)) return false;
  try {
    // Probe with a tiny dummy file — required because canShare throws on some browsers otherwise.
    const probe = new File([new Blob([""], { type: "application/pdf" })], "probe.pdf", {
      type: "application/pdf",
    });
    return (navigator as Navigator & { canShare: (d: { files: File[] }) => boolean }).canShare({
      files: [probe],
    });
  } catch {
    return false;
  }
}

/**
 * Shares the PDF via the native OS share sheet (email, Messages, AirDrop, etc.).
 * Falls back to downloading the PDF if Web Share with files isn't supported
 * or the user cancels/errors. Returns a status string for telemetry/UI.
 */
export async function shareCalculationPdf(
  r: DvResult,
  meta: PdfMeta
): Promise<"shared" | "downloaded" | "cancelled"> {
  const { file, filename } = buildCalculationPdfFile(r, meta);
  const carLine = `${meta.carInitial || ""} ${meta.carNumber || ""}`.trim();
  const title = `Rule 107 DV · ${carLine || filename}`;
  const textLines = [
    "AAR Rule 107 Depreciated Value worksheet",
    carLine ? `Car: ${carLine}` : null,
    meta.railroad ? `Railroad: ${meta.railroad}` : null,
    meta.ddctIncidentNo ? `DDCT: ${meta.ddctIncidentNo}` : null,
    meta.incidentDate ? `Incident: ${fmtDate(meta.incidentDate)}` : null,
  ].filter(Boolean);
  const text = textLines.join("\n");

  if (canNativeShareFiles()) {
    try {
      await (navigator as Navigator & {
        share: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      }).share({ files: [file], title, text });
      return "shared";
    } catch (err) {
      // User dismissed the share sheet — don't fall back to a download.
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Any other error → download fallback.
    }
  }

  // Download fallback (desktop, or browsers without Web Share files support)
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
