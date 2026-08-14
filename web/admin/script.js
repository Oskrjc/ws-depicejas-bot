const statusEl = document.getElementById("status");
const bodyEl = document.getElementById("reservationsBody");

// Header exigido por el servidor en toda ruta de /admin/api/* que modifica
// datos (POST/PATCH/DELETE) — protección CSRF, ver src/security.ts.
const CSRF_HEADERS = { "X-Depicejas-Admin": "1" };

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

/** Link de WhatsApp con el mensaje de confirmación ya redactado (mismo criterio que src/mailer.ts). */
function whatsappConfirmLink(r) {
  if (!r.phone) return null;
  const digits = r.phone.replace(/\D/g, "");
  if (!digits) return null;
  const message = `Hola ${r.name}, tu cita de ${r.service} quedó confirmada para el ${r.preferredDate} a las ${r.preferredTime}. ¡Te esperamos!`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

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
        <td>
          ${
            r.paymentStatus === "approved"
              ? `${whatsappConfirmLink(r) ? `<a class="icon-btn" href="${whatsappConfirmLink(r)}" target="_blank" rel="noopener" title="Confirmar por WhatsApp">💬</a>` : ""}<button type="button" class="icon-btn resend-email-btn" data-id="${r.id}" title="Reenviar correo de confirmación">✉️</button>`
              : ""
          }
          <button type="button" class="icon-btn delete-btn" data-id="${r.id}" title="Eliminar">🗑️</button>
        </td>
      `;
      bodyEl.appendChild(tr);
    }

    bodyEl.querySelectorAll(".contacted-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", async (e) => {
        const id = e.target.getAttribute("data-id");
        await fetch(`/admin/api/reservations/${id}/contacted`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
          body: JSON.stringify({ contacted: e.target.checked }),
        });
        e.target.closest("tr").classList.toggle("contacted", e.target.checked);
      });
    });

    bodyEl.querySelectorAll(".resend-email-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        e.target.disabled = true;
        const originalText = e.target.textContent;
        e.target.textContent = "…";
        try {
          const res = await fetch(`/admin/api/reservations/${id}/resend-email`, {
            method: "POST",
            headers: CSRF_HEADERS,
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            alert("Correo reenviado.");
          } else {
            alert(data.error || "No se pudo reenviar el correo.");
          }
        } finally {
          e.target.disabled = false;
          e.target.textContent = originalText;
        }
      });
    });

    bodyEl.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("¿Eliminar esta reserva? No se puede deshacer.")) return;
        await fetch(`/admin/api/reservations/${id}`, { method: "DELETE", headers: CSRF_HEADERS });
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
const slotsByDayEl = document.getElementById("slotsByDay");

const SLOT_STATUS_LABELS = {
  available: "Disponible",
  booked: "Reservado",
};

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const label = d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function loadSlots() {
  slotsStatusEl.textContent = "Cargando...";
  slotsByDayEl.innerHTML = "";

  try {
    const res = await fetch("/admin/api/slots");
    if (!res.ok) throw new Error("No se pudo cargar los horarios (" + res.status + ")");
    const slots = await res.json();

    if (slots.length === 0) {
      slotsStatusEl.textContent = "No hay horarios cargados todavía.";
      return;
    }

    slotsStatusEl.textContent = slots.length + " horario(s).";

    // Agrupa por fecha, preservando el orden en que ya vienen (ASC por fecha/hora).
    const byDate = new Map();
    for (const s of slots) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    }

    const today = new Date().toISOString().slice(0, 10);
    let isFirst = true;

    for (const [date, daySlots] of byDate) {
      const bookedCount = daySlots.filter((s) => s.status === "booked").length;
      const availableCount = daySlots.length - bookedCount;

      const details = document.createElement("details");
      details.className = "day-group";
      // Abre solo el primer día (normalmente el más próximo) para no saturar la pantalla.
      if (isFirst) details.open = true;
      isFirst = false;

      const summary = document.createElement("summary");
      summary.innerHTML = `
        <span class="day-group-label">${escapeHtml(formatDayLabel(date))}${date === today ? " · hoy" : ""}</span>
        <span class="day-group-count">${availableCount} disponible(s)${bookedCount ? `, ${bookedCount} reservado(s)` : ""}</span>
      `;
      details.appendChild(summary);

      const table = document.createElement("table");
      table.innerHTML = `
        <thead><tr><th>Hora</th><th>Estado</th><th></th></tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");

      for (const s of daySlots) {
        const isBooked = s.status === "booked";
        const badgeClass = isBooked ? "payment-badge-rejected" : "payment-badge-approved";
        const label = SLOT_STATUS_LABELS[s.status] || s.status;
        const withName = isBooked && s.reservationName ? `${label} — ${escapeHtml(s.reservationName)}` : label;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(s.time)}</td>
          <td><span class="payment-badge ${badgeClass}">${withName}</span></td>
          <td>${isBooked ? "" : `<button type="button" class="icon-btn delete-slot-btn" data-id="${s.id}" title="Eliminar">🗑️</button>`}</td>
        `;
        tbody.appendChild(tr);
      }

      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      wrap.appendChild(table);
      details.appendChild(wrap);
      slotsByDayEl.appendChild(details);
    }

    slotsByDayEl.querySelectorAll(".delete-slot-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("¿Eliminar este horario disponible?")) return;
        const res = await fetch(`/admin/api/slots/${id}`, { method: "DELETE", headers: CSRF_HEADERS });
        if (res.ok) {
          const tr = e.target.closest("tr");
          const details = e.target.closest("details");
          tr.remove();
          // Si era el último horario de ese día, colapsa/quita el grupo entero.
          if (details && !details.querySelector("tbody tr")) details.remove();
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
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
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
