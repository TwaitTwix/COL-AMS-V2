import { parentPort, workerData } from "node:worker_threads";
import { createClient } from "@supabase/supabase-js";
import { reportRole } from "../utils/report-role.js";

const PAGE_SIZE = 1000;
const STUDENT_BATCH_SIZE = 400;

function safeText(value) {
  return value == null ? "" : String(value);
}

function safeSpreadsheetValue(value) {
  if (typeof value !== "string") return value ?? "";
  const text = safeText(value);
  // Treat user-provided values as text when they resemble formulas. This
  // protects both CSV and XLSX exports when opened in spreadsheet software.
  return /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
}

function safeSpreadsheetRows(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, safeSpreadsheetValue(value)]),
  ));
}

async function buildCsv(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");
  sheet.columns = [
    { header: "Student", key: "student_name", width: 28 },
    { header: "Student number", key: "student_number", width: 20 },
    { header: "Role (current)", key: "role", width: 24 },
    { header: "Checkpoint", key: "checkpoint", width: 26 },
    { header: "Event ID", key: "event_id", width: 26 },
    { header: "Checked in at (UTC)", key: "checked_in_at", width: 28 },
    { header: "Distance from venue (m)", key: "distance_meters", width: 25 },
  ];
  sheet.addRows(safeSpreadsheetRows(rows));
  const csv = await workbook.csv.writeBuffer();
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv)]);
}

async function buildXlsx(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance Monitoring System";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Attendance");
  sheet.columns = [
    { header: "Student", key: "student_name", width: 28 },
    { header: "Student number", key: "student_number", width: 20 },
    { header: "Role (current)", key: "role", width: 24 },
    { header: "Checkpoint", key: "checkpoint", width: 26 },
    { header: "Event ID", key: "event_id", width: 26 },
    { header: "Checked in at (UTC)", key: "checked_in_at", width: 28 },
    { header: "Distance from venue (m)", key: "distance_meters", width: 25 },
  ];
  sheet.addRows(safeSpreadsheetRows(rows));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172334" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return workbook.xlsx.writeBuffer();
}

async function buildPdf(rows, eventId) {
  const PDFDocument = (await import("pdfkit")).default;
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", layout:"landscape", margin: 42, autoFirstPage: true, bufferPages: true });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    document.fontSize(18).fillColor("#172334").text("Attendance Summary", { continued: false });
    document.moveDown(0.3).fontSize(9).fillColor("#65717d")
      .text(`Event ${safeText(eventId)}  ·  Generated ${new Date().toISOString()}  ·  ${rows.length} check-ins`);
    document.moveDown(1);

    const columns = [
      { label: "Student", key: "student_name", width: 125 },
      { label: "Number", key: "student_number", width: 90 },
      { label: "Role (current)", key: "role", width: 105 },
      {label:"Checkpoint",key:"checkpoint",width:130},
      { label: "Checked in (UTC)", key: "checked_in_at", width: 175 },
      { label: "Distance m", key: "distance_meters", width: 110 },
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const drawHeader = () => {
      let x = document.page.margins.left;
      const y = document.y;
      document.rect(x, y, tableWidth, 23).fill("#172334");
      for (const column of columns) {
        document.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold")
          .text(column.label, x + 5, y + 7, { width: column.width - 10, lineBreak: false });
        x += column.width;
      }
      document.y = y + 29;
    };
    drawHeader();
    for (const row of rows) {
      if (document.y > document.page.height - document.page.margins.bottom - 24) {
        document.addPage();
        drawHeader();
      }
      const y = document.y;
      let x = document.page.margins.left;
      for (const column of columns) {
        const value = safeText(row[column.key]);
        document.fillColor("#263442").font("Helvetica").fontSize(8)
          .text(value, x + 5, y, { width: column.width - 10, height: 18, ellipsis: true, lineBreak: false });
        x += column.width;
      }
      document.moveDown(1.25);
      document.strokeColor("#e8ecef").moveTo(document.page.margins.left, document.y - 3)
        .lineTo(document.page.margins.left + tableWidth, document.y - 3).stroke();
    }
    if (rows.length === 0) document.fontSize(10).fillColor("#65717d").text("No attendance records for this event.");

    const range = document.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      document.switchToPage(pageIndex);
      const footer=`Page ${pageIndex + 1} of ${range.count}`;
      document.fontSize(8).fillColor("#7c8790");
      document.text(footer,document.page.width-42-document.widthOfString(footer),document.page.height-30,{lineBreak:false});
    }
    document.end();
  });
}

async function buildDocx(rows, eventId) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } = await import("docx");
  const headers = ["Student", "Student number", "Role (current)", "Checkpoint", "Event ID", "Checked in at (UTC)", "Distance from venue (m)"];
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: headers.map((header) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: header, bold: true, color: "FFFFFF" })] })],
        shading: { fill: "172334" },
      })),
    }),
    ...rows.map((row) => new TableRow({
      children: ["student_name", "student_number", "role", "checkpoint", "event_id", "checked_in_at", "distance_meters"].map((key) =>
        new TableCell({ children: [new Paragraph(safeText(row[key]))] })),
    })),
  ];
  const document = new Document({
    sections: [{ children: [
      new Paragraph({ text: "Attendance Summary", heading: HeadingLevel.TITLE }),
      new Paragraph(`Event ${safeText(eventId)} · Generated ${new Date().toISOString()} · ${rows.length} check-ins`),
      new Paragraph(""),
      new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
    ] }],
  });
  return Packer.toBuffer(document);
}

const builders = { csv: buildCsv, xlsx: buildXlsx, pdf: buildPdf, docx: buildDocx };

async function fetchReportRows() {
  const client = createClient(workerData.supabaseUrl, workerData.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const attendance = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("attendance_logs")
      .select("id, student_id, user_id, event_id, distance_from_venue_meters, checked_in_at, entry_method, checkpoint_label")
      .eq("event_id", workerData.eventId)
      .eq('status','approved')
      .order("checked_in_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    attendance.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const studentIds = [...new Set(attendance.map((row) => row.student_id).filter(Boolean))];
  const studentsById = new Map();
  for (let start = 0; start < studentIds.length; start += STUDENT_BATCH_SIZE) {
    const batch = studentIds.slice(start, start + STUDENT_BATCH_SIZE);
    const { data, error } = await client.from("students")
      .select("id, name, student_number")
      .in("id", batch);
    if (error) throw error;
    for (const student of data || []) studentsById.set(String(student.id), student);
  }

  const profilesByUser=new Map(),profilesByStudent=new Map();
  for(let start=0;start<studentIds.length;start+=STUDENT_BATCH_SIZE){
    const {data,error}=await client.from("user_profiles").select("user_id,student_id,role").in("student_id",studentIds.slice(start,start+STUDENT_BATCH_SIZE));
    if(error)throw error;for(const profile of data||[])profilesByStudent.set(profile.student_id,profile);
  }
  const userIds=[...new Set(attendance.map(row=>row.user_id).filter(Boolean))];
  for(let start=0;start<userIds.length;start+=STUDENT_BATCH_SIZE){
    const {data,error}=await client.from("user_profiles").select("user_id,student_id,role").in("user_id",userIds.slice(start,start+STUDENT_BATCH_SIZE));
    if(error)throw error;for(const profile of data||[])profilesByUser.set(profile.user_id,profile);
  }
  return attendance.map((row) => {
    const student = studentsById.get(String(row.student_id));
    return {
      student_name: student?.name || "Student unavailable",
      student_number: student?.student_number || "",
      role:reportRole(row,profilesByUser,profilesByStudent),
      checkpoint:row.checkpoint_label||"Attendance",
      event_id: String(row.event_id),
      checked_in_at: row.checked_in_at || "",
      distance_meters: row.distance_from_venue_meters!==null && Number.isFinite(Number(row.distance_from_venue_meters))
        ? Number(row.distance_from_venue_meters)
        : (row.entry_method==='manual'?"Manual / not measured":""),
    };
  });
}

export async function buildReport(format,rows,eventId){
  const output=await builders[format](rows,eventId);
  const preview=format==="pdf"?output:await buildPdf(rows,eventId);
  return {output,preview};
}

if(parentPort)try {
  const rows = await fetchReportRows();
  const {output,preview:pdfPreview}=await buildReport(workerData.format,rows,workerData.eventId);
  const transferable = Uint8Array.from(output);
  const preview=workerData.format==='pdf'?null:Uint8Array.from(pdfPreview);
  parentPort.postMessage({ ok: true, bytes: transferable, previewBytes:preview, recordCount: rows.length }, preview?[transferable.buffer,preview.buffer]:[transferable.buffer]);
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.message || "Report build failed" });
}
