const studentView = document.querySelector("#student-view");
const studentName = document.querySelector("#student-name");
const studentNumber = document.querySelector("#student-number");
const studentQr = document.querySelector("#student-qr");
const studentHistory = document.querySelector("#student-history");
const backToConsole = document.querySelector("#back-to-console");
const passToggle = document.querySelector("#student-pass-toggle");
const consoleView = document.querySelector("#console-view");
const authPanel = document.querySelector("#auth-panel");
let session = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function loadStudentPortal(accessToken) {
  studentName.textContent = "Loading student profile…";
  studentHistory.textContent = "Loading attendance history…";
  studentQr.replaceChildren();
  try {
    const response = await fetch("/api/student/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Could not load the student portal.");

    const { student, attendance } = payload;
    studentName.textContent = student.name;
    studentNumber.textContent = `Student no. ${student.student_number}`;
    if (student.archived_at) {
      studentQr.textContent = "This student pass is archived.";
      studentHistory.innerHTML = attendance.length
        ? attendance.map((record) => `<article class="history-row"><div><strong>${escapeHtml(record.events?.name || "Attendance event")}</strong><span>${escapeHtml(formatDate(record.checked_in_at))}</span></div><span class="history-distance">${Math.round(Number(record.distance_from_venue_meters))} m</span></article>`).join("")
        : '<div class="empty-state">No check-ins recorded.</div>';
      return;
    }
    if (window.QRCode) {
      new QRCode(studentQr, { text: student.student_token, width: 188, height: 188, colorDark: "#10201f", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    } else {
      studentQr.textContent = "QR generator unavailable";
    }
    studentHistory.innerHTML = attendance.length
      ? attendance.map((record) => `<article class="history-row"><div><strong>${escapeHtml(record.events?.name || "Attendance event")}</strong><span>${escapeHtml(formatDate(record.checked_in_at))}</span></div><span class="history-distance">${Math.round(Number(record.distance_from_venue_meters))} m</span></article>`).join("")
      : '<div class="empty-state">No check-ins recorded yet. Your verified attendance will appear here.</div>';
  } catch (error) {
    studentName.textContent = "Student profile unavailable";
    studentNumber.textContent = "";
    studentQr.textContent = "";
    studentHistory.textContent = error.message;
  }
}

function showStudentView() {
  if (!session) return;
  authPanel.hidden = true;
  consoleView.hidden = true;
  studentView.hidden = false;
  backToConsole.hidden = !["student_officer", "officer", "admin", "col_officer"].includes(session.role);
  void loadStudentPortal(session.accessToken);
}

backToConsole.addEventListener("click", () => {
  studentView.hidden = true;
  consoleView.hidden = false;
});

passToggle.addEventListener("click", showStudentView);

window.addEventListener("app:session", (event) => {
  session = event.detail || null;
  if (!session) {
    studentView.hidden = true;
    passToggle.hidden = true;
    return;
  }
  const isStudent = ["student", "student_officer"].includes(session.role);
  passToggle.hidden = !["student_officer", "officer", "admin", "col_officer"].includes(session.role);
  if (session.role === "student") showStudentView();
  else if (!isStudent) studentView.hidden = true;
});
