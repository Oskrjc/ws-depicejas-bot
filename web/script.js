document.getElementById("year").textContent = new Date().getFullYear();

const navToggle = document.getElementById("navToggle");
const siteNav = document.querySelector(".nav");
if (navToggle && siteNav) {
  const closeNav = () => {
    siteNav.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  };
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("open");
    navToggle.classList.toggle("open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
}

const carouselTrack = document.getElementById("carouselTrack");
if (carouselTrack) {
  const scrollAmount = () => carouselTrack.querySelector(".carousel-slide").offsetWidth + 16;
  document.querySelector(".carousel-prev").addEventListener("click", () => {
    carouselTrack.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
  });
  document.querySelector(".carousel-next").addEventListener("click", () => {
    carouselTrack.scrollBy({ left: scrollAmount(), behavior: "smooth" });
  });
}

const reservationForm = document.getElementById("reservationForm");
if (reservationForm) {
  const submitBtn = document.getElementById("reservationSubmit");
  const messageEl = document.getElementById("reservationMessage");
  const servicesPicker = document.getElementById("servicesPicker");
  const serviceCheckboxes = () => Array.from(servicesPicker.querySelectorAll('input[name="services"]'));
  const servicesTotalEl = document.getElementById("servicesTotal");
  const servicesEmptyHint = document.getElementById("servicesEmptyHint");
  const depositAmountEl = document.getElementById("depositAmount");
  const fullAmountEl = document.getElementById("fullAmount");
  const dateSelect = document.getElementById("res-date");
  const timeSelect = document.getElementById("res-time");
  const slotsEmptyHint = document.getElementById("slotsEmptyHint");

  // Horarios disponibles cargados desde /api/slots, agrupados por fecha:
  // { "2026-08-20": ["10:00", "10:30", ...], ... }
  let slotsByDate = {};

  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const label = d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function populateTimeOptions(date) {
    const times = slotsByDate[date] || [];
    timeSelect.innerHTML = "";
    if (times.length === 0) {
      timeSelect.innerHTML = '<option value="">Sin horas disponibles</option>';
      timeSelect.disabled = true;
      return;
    }
    timeSelect.innerHTML = '<option value="">Elige una hora</option>' + times.map((t) => `<option value="${t}">${t}</option>`).join("");
    timeSelect.disabled = false;
  }

  async function loadAvailableSlots() {
    try {
      const res = await fetch("/api/slots");
      if (!res.ok) throw new Error();
      const slots = await res.json();

      slotsByDate = {};
      for (const s of slots) {
        (slotsByDate[s.date] = slotsByDate[s.date] || []).push(s.time);
      }
      const dates = Object.keys(slotsByDate).sort();

      if (dates.length === 0) {
        dateSelect.innerHTML = '<option value="">No hay fechas disponibles</option>';
        dateSelect.disabled = true;
        timeSelect.innerHTML = '<option value="">—</option>';
        timeSelect.disabled = true;
        slotsEmptyHint.classList.add("visible");
        return;
      }

      slotsEmptyHint.classList.remove("visible");
      dateSelect.innerHTML =
        '<option value="">Elige una fecha</option>' +
        dates.map((d) => `<option value="${d}">${formatDateLabel(d)}</option>`).join("");
      dateSelect.disabled = false;
      timeSelect.innerHTML = '<option value="">Elige una fecha primero</option>';
      timeSelect.disabled = true;
    } catch {
      dateSelect.innerHTML = '<option value="">No se pudieron cargar los horarios</option>';
      dateSelect.disabled = true;
      slotsEmptyHint.classList.add("visible");
    }
  }

  dateSelect.addEventListener("change", () => populateTimeOptions(dateSelect.value));
  loadAvailableSlots();

  function formatClp(amount) {
    return "$" + amount.toLocaleString("es-CL");
  }

  function getSelectedTotal() {
    return serviceCheckboxes()
      .filter((cb) => cb.checked)
      .reduce((sum, cb) => sum + Number(cb.dataset.price || 0), 0);
  }

  function updateTotals() {
    const total = getSelectedTotal();
    servicesTotalEl.textContent = "Total servicios: " + formatClp(total);
    depositAmountEl.textContent = total > 0 ? "(" + formatClp(Math.round(total * 0.2)) + ")" : "";
    fullAmountEl.textContent = total > 0 ? "(" + formatClp(total) + ")" : "";
  }

  servicesPicker.addEventListener("change", updateTotals);
  updateTotals();

  reservationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageEl.textContent = "";
    messageEl.className = "form-message";
    servicesEmptyHint.classList.remove("visible");

    const selectedServices = serviceCheckboxes()
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    if (selectedServices.length === 0) {
      servicesEmptyHint.classList.add("visible");
      servicesPicker.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!dateSelect.value || !timeSelect.value) {
      messageEl.textContent = "Elige una fecha y una hora disponibles.";
      messageEl.className = "form-message error";
      dateSelect.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    const formData = new FormData(reservationForm);
    formData.delete("services");
    const payload = Object.fromEntries(formData.entries());
    payload.services = selectedServices;

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo enviar la solicitud.");
      }

      if (!data.checkoutUrl) {
        throw new Error("No se pudo generar el link de pago. Intenta de nuevo o escríbenos por WhatsApp.");
      }

      messageEl.textContent = "¡Listo! Te estamos llevando a MercadoPago para completar el pago…";
      messageEl.className = "form-message success";
      submitBtn.textContent = "Redirigiendo…";
      window.location.href = data.checkoutUrl;
      return; // no reactivar el botón — la página va a navegar fuera de aquí
    } catch (err) {
      messageEl.textContent = err.message || "Ocurrió un error. Intenta de nuevo o escríbenos por WhatsApp.";
      messageEl.className = "form-message error";
      // Si el horario ya no estaba disponible (otra clienta se lo llevó
      // justo antes), refrescamos la lista para que no siga apareciendo.
      loadAvailableSlots();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "IR A PAGAR";
    }
  });
}
