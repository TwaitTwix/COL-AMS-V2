const startButton = document.querySelector("#start-camera");
const stopButton = document.querySelector("#stop-camera");
const cameraPlaceholder = document.querySelector("#camera-placeholder");
const eventIdInput = document.querySelector("#event-id");
const result = document.querySelector("#result");
const resultIcon = document.querySelector("#result-icon");
const resultTitle = document.querySelector("#result-title");
const resultMessage = document.querySelector("#result-message");
const cameraNote = document.querySelector("#camera-note");

let scanner = null;
let cameraActive = false;
let processingScan = false;
let sessionAccessToken = null;
let sessionRole = null;

window.addEventListener("app:session", (event) => {
  sessionAccessToken = event.detail?.accessToken || null;
  sessionRole = event.detail?.role || null;
});

const eventIdFromUrl = new URLSearchParams(window.location.search).get("event_id");
if (eventIdFromUrl) eventIdInput.value = eventIdFromUrl;

function showResult(state, title, message) {
  result.dataset.state = state;
  resultTitle.textContent = title;
  resultMessage.textContent = message;
  resultIcon.textContent = state === "success" ? "✓" : state === "error" ? "!" : state === "loading" ? "·" : "✓";
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is unavailable on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const messages = {
        1: "Location permission denied. Allow location access and try again.",
        2: "Your location could not be determined. Move to an area with a clear GPS signal and try again.",
        3: "Location request timed out. Please try scanning again.",
      };
      reject(new Error(messages[error.code] || "Unable to get your location. Please try again."));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

async function stopCamera() {
  if (!scanner || !cameraActive) return;
  try {
    await scanner.stop();
    scanner.clear();
  } catch (error) {
    console.warn("Unable to stop scanner cleanly:", error);
  } finally {
    cameraActive = false;
    cameraPlaceholder.hidden = false;
    startButton.hidden = false;
    stopButton.hidden = true;
  }
}

async function submitCheckIn(studentToken, position) {
  if (!sessionAccessToken) throw new Error("Sign in with an approved officer account to check in students.");
  const eventId = eventIdInput.value.trim();
  if (!eventId) throw new Error("Enter the active event ID before scanning.");

  let response;
  try {
    response = await fetch("/api/attendance/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionAccessToken}` },
      body: JSON.stringify({
        student_token: studentToken,
        event_id: eventId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
    });
  } catch {
    throw new Error("Unable to reach the check-in service. Check the connection and try again.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "Check-in could not be completed.");
  const studentName = payload.student?.name || "Student";
  return `${studentName} is checked in. Distance verified.`;
}

async function handleQrDetected(decodedText) {
  if (processingScan) return;
  processingScan = true;
  startButton.disabled = true;
  showResult("loading", "Getting location…", "Keep this page open while we verify the check-in.");

  // Start location lookup immediately on detection, before waiting for camera teardown.
  const locationPromise = getCurrentPosition();
  void stopCamera();

  try {
    const position = await locationPromise;
    showResult("loading", "Verifying check-in…", "Confirming the student and event location.");
    const confirmation = await submitCheckIn(decodedText.trim(), position);
    showResult("success", "Check-in successful", confirmation);
  } catch (error) {
    showResult("error", "Check-in not completed", error.message);
  } finally {
    processingScan = false;
    startButton.disabled = false;
    startButton.textContent = "Scan next student";
  }
}

async function startCamera() {
  if (!sessionAccessToken || !["student_officer", "officer", "admin", "col_officer"].includes(sessionRole)) {
    showResult("error", "Officer access required", "Sign in with an approved officer account to start scanning.");
    return;
  }
  if (!eventIdInput.value.trim()) {
    showResult("error", "Event ID needed", "Enter the active event ID before starting the scanner.");
    eventIdInput.focus();
    return;
  }
  if (!window.Html5Qrcode) {
    showResult("error", "Scanner unavailable", "The QR scanner could not load. Check your connection and refresh.");
    return;
  }

  startButton.disabled = true;
  showResult("loading", "Opening camera…", "Allow camera access when your browser asks.");
  try {
    scanner = new Html5Qrcode("reader", { verbose: false });
    await scanner.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: (width,height)=>{const side=Math.floor(Math.min(230,Math.min(width,height)*.72));return {width:side,height:side};}, aspectRatio: 1.0 },
      handleQrDetected,
      () => {},
    );
    cameraActive = true;
    cameraPlaceholder.hidden = true;
    startButton.hidden = true;
    stopButton.hidden = false;
    cameraNote.innerHTML = '<span class="note-icon">⌖</span> Camera active · Point at a student QR pass';
    showResult("idle", "Ready to scan", "Hold the QR code steady inside the camera frame.");
  } catch (error) {
    const message = error?.message?.toLowerCase().includes("permission")
      ? "Camera permission denied. Allow camera access in your browser settings and try again."
      : "Could not open the camera. Make sure this page uses HTTPS and camera access is allowed.";
    showResult("error", "Camera unavailable", message);
    if (scanner) {
      try { scanner.clear(); } catch { /* Camera did not start. */ }
      scanner = null;
    }
  } finally {
    startButton.disabled = false;
  }
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", async () => {
  await stopCamera();
  showResult("idle", "Scanner paused", "Start the camera when the next student is ready.");
  cameraNote.innerHTML = '<span class="note-icon">⌖</span> Camera and location access are needed to verify check-ins.';
});

const generateReportButton = document.querySelector("#generate-report");
const reportFormat = document.querySelector("#report-format");
const reportStatus = document.querySelector("#report-status");
const reportDownload = document.querySelector("#report-download");
const reportsCard = document.querySelector(".reports-card");

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readApiError(response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error?.message || `Request failed (${response.status}).`;
}

async function pollReport(statusUrl) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(1000);
    const response = await fetch(statusUrl, { headers: { Authorization: `Bearer ${sessionAccessToken}` } });
    if (!response.ok) throw new Error(await readApiError(response));
    const job = await response.json();
    if (job.status === "completed") {
      reportStatus.textContent = `Report ready · ${job.record_count} check-ins · Download link expires in ${Math.round(job.expires_in_seconds / 60)} minutes.`;
      reportDownload.href = job.download_url;
      reportDownload.hidden = false;
      return;
    }
    if (job.status === "failed") throw new Error(job.error || "Report generation failed.");
    reportStatus.textContent = job.status === "queued" ? "Report queued…" : "Generating report securely…";
  }
  throw new Error("This report is taking longer than expected. You can submit another request later.");
}

generateReportButton.addEventListener("click", async () => {
  const eventId = eventIdInput.value.trim();
  if (!["admin", "col_officer"].includes(sessionRole) || !sessionAccessToken) {
    reportStatus.textContent = "Sign in with an approved administrator account to generate reports.";
    return;
  }
  if (!eventId) {
    reportStatus.textContent = "Enter the event ID in the scanner panel above.";
    eventIdInput.focus();
    return;
  }
  generateReportButton.disabled = true;
  reportsCard.setAttribute("aria-busy", "true");
  reportDownload.hidden = true;
  reportStatus.textContent = "Submitting report job…";
  try {
    const response = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionAccessToken}` },
      body: JSON.stringify({ event_id: eventId, format: reportFormat.value }),
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const job = await response.json();
    reportStatus.textContent = "Report queued…";
    await pollReport(job.status_url);
  } catch (error) {
    reportStatus.textContent = error.message;
  } finally {
    reportsCard.removeAttribute("aria-busy");
    generateReportButton.disabled = false;
  }
});
