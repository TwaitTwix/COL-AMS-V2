const managementCard = document.querySelector("#admin-management-card");
const userList = document.querySelector("#managed-users");
const eventList = document.querySelector("#managed-events");
const studentList = document.querySelector("#managed-students");
const auditList = document.querySelector("#admin-audit");
const studentForm = document.querySelector("#create-student-form");
const eventForm = document.querySelector("#create-event-form");
const roleOptions = ["pending", "student", "student_officer", "col_officer", "officer", "admin"];
let adminSession = null;
let students = [];
let events = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${adminSession.accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status})`);
  return payload;
}

async function loadUsers() {
  const { users } = await api("/api/admin/users");
  userList.innerHTML = users.length ? users.map((user) => {
    const options = roleOptions.map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role.replaceAll("_", " ")}</option>`).join("");
    const studentOptions = ['<option value="">No student link</option>', ...students.map((student) => `<option value="${escapeHtml(student.id)}" ${user.student_id === student.id ? "selected" : ""}>${escapeHtml(student.name)} · ${escapeHtml(student.student_number)}</option>`)].join("");
    return `<article class="managed-user" data-user-id="${escapeHtml(user.user_id)}"><div class="managed-user-identity"><strong>${escapeHtml(user.full_name || "Staff account")}</strong><span>${escapeHtml(user.email || user.user_id)}</span></div><select class="managed-role" aria-label="Account role">${options}</select><select class="managed-student" aria-label="Linked student record">${studentOptions}</select><button class="small-action save-user-role" type="button">Save</button></article>`;
  }).join("") : '<div class="empty-state">No accounts have signed in yet.</div>';
}

async function loadStudents() {
  const response = await api("/api/admin/students");
  students = response.students;
  studentList.innerHTML = students.length ? students.map((student) => `<article class="managed-event"><div><strong>${escapeHtml(student.name)}${student.archived_at ? " · Archived" : ""}</strong><span>${escapeHtml(student.student_number)}</span></div><div class="row-actions"><button class="small-action edit-student" type="button" data-student-id="${escapeHtml(student.id)}">Edit</button><button class="small-action toggle-student-archive" type="button" data-student-id="${escapeHtml(student.id)}" data-archived="${Boolean(student.archived_at)}">${student.archived_at ? "Restore" : "Archive"}</button></div></article>`).join("") : '<div class="empty-state">No students yet.</div>';
  await loadUsers();
}

async function loadEvents() {
  const response = await api("/api/admin/events");
  events = response.events;
  eventList.innerHTML = events.length ? events.map((event) => `<article class="managed-event"><div><strong>${escapeHtml(event.name)}${event.archived_at ? " · Archived" : ""}</strong><span>${escapeHtml(event.id)}</span><small>${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.starts_at)))} – ${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.ends_at)))}</small></div><div class="row-actions"><button class="small-action use-event" type="button" data-event-id="${escapeHtml(event.id)}" ${event.archived_at ? "disabled" : ""}>Use</button><button class="small-action edit-event" type="button" data-event-id="${escapeHtml(event.id)}">Edit</button><button class="small-action toggle-event-archive" type="button" data-event-id="${escapeHtml(event.id)}" data-archived="${Boolean(event.archived_at)}">${event.archived_at ? "Restore" : "Archive"}</button></div></article>`).join("") : '<div class="empty-state">No events yet. Create one to enable check-ins.</div>';
}

async function loadAudit() {
  const { logs } = await api("/api/admin/audit-logs?limit=50");
  auditList.innerHTML = logs.length ? logs.map((entry) => {
    const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at));
    const actor = entry.actor?.full_name || entry.actor?.email || "Former or unavailable account";
    return `<article class="managed-event"><div><strong>${escapeHtml(entry.action.replaceAll(".", " "))}</strong><span>${escapeHtml(actor)} · ${escapeHtml(entry.entity_type)} ${escapeHtml(entry.entity_id || "")}</span><small>${escapeHtml(when)}</small></div></article>`;
  }).join("") : '<div class="empty-state">No activity has been recorded yet.</div>';
}

async function refreshManagement() {
  userList.textContent = "Loading accounts…";
  try {
    await Promise.all([loadStudents(), loadEvents(), loadAudit()]);
  } catch (error) {
    userList.textContent = error.message;
    eventList.textContent = error.message;
    auditList.textContent = error.message;
  }
}

window.addEventListener("app:session", (event) => {
  adminSession = event.detail && ["admin", "col_officer"].includes(event.detail.role) ? event.detail : null;
  managementCard.hidden = !adminSession;
  if (adminSession) void refreshManagement();
});

userList.addEventListener("click", async (event) => {
  const button = event.target.closest(".save-user-role");
  if (!button || !adminSession) return;
  const row = button.closest(".managed-user");
  const role = row.querySelector(".managed-role").value;
  const studentId = row.querySelector(".managed-student").value || null;
  button.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(row.dataset.userId)}`, {
      method: "PATCH", body: JSON.stringify({ role, student_id: studentId }),
    });
    await Promise.all([loadUsers(), loadAudit()]);
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

studentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#student-create-status");
  const values = new FormData(studentForm);
  const studentId = String(values.get("student_id") || "");
  status.textContent = "Creating student pass…";
  try {
    const { student } = await api(studentId ? `/api/admin/students/${encodeURIComponent(studentId)}` : "/api/admin/students", {
      method: studentId ? "PATCH" : "POST",
      body: JSON.stringify({ name: String(values.get("name")).trim(), student_number: String(values.get("student_number")).trim() }),
    });
    status.textContent = `${student.name} was ${studentId ? "updated" : "added"}. Link this student record to a student account above to enable their portal.`;
    studentForm.reset();
    studentForm.querySelector("button[type='submit']").innerHTML = 'Create student pass <span aria-hidden="true">→</span>';
    studentForm.querySelector(".cancel-student-edit").hidden = true;
    await Promise.all([loadStudents(), loadAudit()]);
  } catch (error) {
    status.textContent = error.message;
  }
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#event-create-status");
  const values = new FormData(eventForm);
  const localIso = (name) => new Date(String(values.get(name))).toISOString();
  status.textContent = "Creating event…";
  try {
    const eventId = String(values.get("event_id") || "");
    await api(eventId ? `/api/admin/events/${encodeURIComponent(eventId)}` : "/api/admin/events", {
      method: eventId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: String(values.get("name")).trim(),
        latitude: Number(values.get("latitude")),
        longitude: Number(values.get("longitude")),
        radius_meters: Number(values.get("radius_meters")),
        starts_at: localIso("starts_at"),
        ends_at: localIso("ends_at"),
      }),
    });
    status.textContent = `${eventId ? "Event updated" : "Event created"}. Select it below to load its ID into the scanner.`;
    eventForm.reset();
    eventForm.elements.radius_meters.value = "100";
    eventForm.querySelector("button[type='submit']").innerHTML = 'Create event <span aria-hidden="true">→</span>';
    eventForm.querySelector(".cancel-event-edit").hidden = true;
    await Promise.all([loadEvents(), loadAudit()]);
  } catch (error) {
    status.textContent = error.message;
  }
});

eventList.addEventListener("click", (event) => {
  const useButton = event.target.closest(".use-event");
  if (useButton) {
    document.querySelector("#event-id").value = useButton.dataset.eventId;
    document.querySelector("#event-id").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const editButton = event.target.closest(".edit-event");
  if (editButton) {
    const item = events.find((candidate) => candidate.id === editButton.dataset.eventId);
    if (!item) return;
    eventForm.elements.event_id.value = item.id;
    eventForm.elements.name.value = item.name;
    eventForm.elements.latitude.value = item.latitude;
    eventForm.elements.longitude.value = item.longitude;
    eventForm.elements.radius_meters.value = item.radius_meters;
    const asLocalTime = (value) => {
      const date = new Date(value);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    eventForm.elements.starts_at.value = asLocalTime(item.starts_at);
    eventForm.elements.ends_at.value = asLocalTime(item.ends_at);
    eventForm.querySelector("button[type='submit']").textContent = "Save event";
    eventForm.querySelector(".cancel-event-edit").hidden = false;
    eventForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const archiveButton = event.target.closest(".toggle-event-archive");
  if (archiveButton) {
    const archived = archiveButton.dataset.archived !== "true";
    void api(`/api/admin/events/${encodeURIComponent(archiveButton.dataset.eventId)}/archive`, {
      method: "PATCH", body: JSON.stringify({ archived }),
    }).then(() => Promise.all([loadEvents(), loadAudit()])).catch((error) => window.alert(error.message));
  }
});

studentList.addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-student");
  if (editButton) {
    const student = students.find((candidate) => candidate.id === editButton.dataset.studentId);
    if (!student) return;
    studentForm.elements.student_id.value = student.id;
    studentForm.elements.name.value = student.name;
    studentForm.elements.student_number.value = student.student_number;
    studentForm.querySelector("button[type='submit']").textContent = "Save student";
    studentForm.querySelector(".cancel-student-edit").hidden = false;
    studentForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const archiveButton = event.target.closest(".toggle-student-archive");
  if (archiveButton) {
    const archived = archiveButton.dataset.archived !== "true";
    void api(`/api/admin/students/${encodeURIComponent(archiveButton.dataset.studentId)}/archive`, {
      method: "PATCH", body: JSON.stringify({ archived }),
    }).then(() => Promise.all([loadStudents(), loadAudit()])).catch((error) => window.alert(error.message));
  }
});

studentForm.querySelector(".cancel-student-edit").addEventListener("click", () => {
  studentForm.reset();
  studentForm.querySelector("button[type='submit']").innerHTML = 'Create student pass <span aria-hidden="true">→</span>';
  studentForm.querySelector(".cancel-student-edit").hidden = true;
});

eventForm.querySelector(".cancel-event-edit").addEventListener("click", () => {
  eventForm.reset();
  eventForm.elements.radius_meters.value = "100";
  eventForm.querySelector("button[type='submit']").innerHTML = 'Create event <span aria-hidden="true">→</span>';
  eventForm.querySelector(".cancel-event-edit").hidden = true;
});
