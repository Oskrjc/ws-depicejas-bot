const statusEl = document.getElementById("status");
const bodyEl = document.getElementById("reservationsBody");

function formatDate(iso) {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const PAYMENT_LABELS = {
  approved: "Pagado",
  pending: "Pendiente",
  in_process: "En proceso",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  charged_back: "Contracargo",
};

function formatClp(amount) {
  if (amount == null) return "—";
  return "$" + Number(amount).toLocaleString("es-CL");
}

const PAYMENT_OPTION_LABELS = {
  deposit: "Abono 20%",
  full: "Pago completo",
};

function paymentBadge(r) {
  const status = r.paymentStatus || "pending";
  const label = PAYMENT_LABELS[status] || status;
  const optionLabel = PAYMENT_OPTION_LABELS[r.paymentOption] || "";
  return `<span class="payment-badge payment-badge-${escapeHtml(status)}">${escapeHtml(label)}</span><br><small>${formatClp(r.price)}${optionLabel ? " · " + escapeHtml(optionLabel) : ""}</small>`;
}

async function loadReservations() {
  statusEl.textContent = "Cargando...";
  bodyEl.innerHTML = "";

  try {
    const res = await fetch("/admin/api/reservations");
    if (!res.ok) throw new Error("No se pudo cargar la lista (" + res.status + ")");
    const reservations = await res.json();

    if (reservations.length === 0) {
      statusEl.textContent = "No hay reservas todavía.";
      return;
    }

    statusEl.textContent = reservations.length + " reserva(s).";

    for (const r of reservations) {
      const tr = document.createElement("tr");
      tr.className = r.contacted ? "contacted" : "";
      tr.innerHTML = `
        <td>${formatDate(r.createdAt)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td><a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a></td>
        <td>${escapeHtml(r.phone || "—")}</td>
        <td>${escapeHtml(r.service)}</td>
        <td>${escapeHtml(r.preferredDate)}</td>
        <td>${escapeHtml(r.preferredTime)}</td>
        <td class="notes-cell">${escapeHtml(r.notes || "—")}</td>
        <td>${paymentBadge(r)}</td>
        <td><input type="checkbox" data-id="${r.id}" class="contacted-checkbox" ${r.contacted ? "checked" : ""} /></td>
        <td><button type="button" class="icon-btn delete-btn" data-id="${r.id}" title="Eliminar">🗑️</button></td>
      `;
      bodyEl.appendChild(tr);
    }

    bodyEl.querySelectorAll(".contacted-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", async (e) => {
        const id = e.target.getAttribute("data-id");
        await fetch(`/admin/api/reservations/${id}/contacted`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacted: e.target.checked }),
        });
        e.target.closest("tr").classList.toggle("contacted", e.target.checked);
      });
    });

    bodyEl.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("¿Eliminar esta reserva? No se puede deshacer.")) return;
        await fetch(`/admin/api/reservations/${id}`, { method: "DELETE" });
        e.target.closest("tr").remove();
      });
    });
  } catch (err) {
    statusEl.textContent = err.message || "Ocurrió un error al cargar las reservas.";
  }
}

document.getElementById("refreshBtn").addEventListener("click", loadReservations);
loadReservations();

// ── Horarios disponibles ───────────────────────────────────────────────────
const slotsStatusEl = document.getElementById("slotsStatus");
const slotsBodyEl = document.getElementById("slotsBody");

const SLOT_STATUS_LABELS = {
  available: "Disponible",
  booked: "Reservado",
};

async function loadSlots() {
  slotsStatusEl.textContent = "Cargando...";
  slotsBodyEl.innerHTML = "";

  try {
    const res = await fetch("/admin/api/slots");
    if (!res.ok) throw new Error("No se pudo cargar los horarios (" + res.status + ")");
    const slots = await res.json();

    if (slots.length === 0) {
      slotsStatusEl.textContent = "No hay horarios cargados todavía.";
      return;
    }

    slotsStatusEl.textContent = slots.length + " horario(s).";

    for (const s of slots) {
      const isBooked = s.status === "booked";
      const badgeClass = isBooked ? "payment-badge-rejected" : "payment-badge-approved";
      const label = SLOT_STATUS_LABELS[s.status] || s.status;
      const withName = isBooked && s.reservationName ? `${label} — ${escapeHtml(s.reservationName)}` : label;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.date)}</td>
        <td>${escapeHtml(s.time)}</td>
        <td><span class="payment-badge ${badgeClass}">${withName}</span></td>
        <td>${isBooked ? "" : `<button type="button" class="icon-btn delete-slot-btn" data-id="${s.id}" title="Eliminar">🗑️</button>`}</td>
      `;
      slotsBodyEl.appendChild(tr);
    }

    slotsBodyEl.querySelectorAll(".delete-slot-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("¿Eliminar este horario disponible?")) return;
        const res = await fetch(`/admin/api/slots/${id}`, { method: "DELETE" });
        if (res.ok) {
          e.target.closest("tr").remove();
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "No se pudo eliminar el horario.");
        }
      });
    });
  } catch (err) {
    slotsStatusEl.textContent = err.message || "Ocurrió un error al cargar los horarios.";
  }
}

document.getElementById("addSlotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById("slotDate");
  const timesInput = document.getElementById("slotTimes");

  const date = dateInput.value;
  const times = timesInput.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!date || times.length === 0) return;

  const res = await fetch("/admin/api/slots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, times }),
  });

  if (res.ok) {
    timesInput.value = "";
    loadSlots();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "No se pudo agregar el horario.");
  }
});

loadSlots();
