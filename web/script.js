document.getElementById("year").textContent = new Date().getFullYear();

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

  reservationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageEl.textContent = "";
    messageEl.className = "form-message";
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    const formData = new FormData(reservationForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo enviar la solicitud.");
      }

      messageEl.textContent = "¡Listo! Revisa tu correo — te escribiremos pronto para confirmar.";
      messageEl.className = "form-message success";
      reservationForm.reset();
    } catch (err) {
      messageEl.textContent = err.message || "Ocurrió un error. Intenta de nuevo o escríbenos por WhatsApp.";
      messageEl.className = "form-message error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar solicitud";
    }
  });
}
