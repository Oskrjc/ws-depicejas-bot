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
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "IR A PAGAR";
    }
  });
}
