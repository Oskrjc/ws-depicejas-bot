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
