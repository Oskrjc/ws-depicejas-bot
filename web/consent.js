/**
 * Banner de consentimiento de cookies — bloquea Google Tag Manager hasta
 * que el usuario acepte explícitamente. Antes GTM se cargaba directo en el
 * <head> de cada página, sin pedir permiso (hallazgo de la auditoría de
 * privacidad). Ahora GTM solo se inyecta si el usuario hace clic en
 * "Aceptar"; si rechaza (o no decide todavía), no se carga nada.
 */
(function () {
  var GTM_ID = "GTM-W95DVRLX";
  var STORAGE_KEY = "depicejas_cookie_consent"; // "accepted" | "rejected"

  function loadGTM() {
    if (window.__gtmLoaded) return;
    window.__gtmLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    var f = document.getElementsByTagName("script")[0];
    var j = document.createElement("script");
    j.async = true;
    j.src = "https://www.googletagmanager.com/gtm.js?id=" + GTM_ID;
    f.parentNode.insertBefore(j, f);
  }

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      // Si el navegador bloquea localStorage (modo privado estricto, etc.),
      // simplemente no recordamos la elección — el banner volverá a
      // aparecer en la próxima visita, lo cual es un fallback seguro.
    }
  }

  function hideBanner() {
    var banner = document.getElementById("cookieBanner");
    if (banner) banner.remove();
  }

  function showBanner() {
    if (document.getElementById("cookieBanner")) return;

    var banner = document.createElement("div");
    banner.id = "cookieBanner";
    banner.className = "cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Preferencias de cookies");
    banner.innerHTML =
      '<p>Usamos cookies analíticas (Google Analytics) para entender cómo se usa el sitio. No afecta tu reserva. ' +
      '<a href="politica-cookies.html">Más información</a>.</p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" class="btn-cookie-reject" id="cookieReject">Rechazar</button>' +
      '<button type="button" class="btn-cookie-accept" id="cookieAccept">Aceptar</button>' +
      "</div>";

    document.body.appendChild(banner);

    document.getElementById("cookieAccept").addEventListener("click", function () {
      setConsent("accepted");
      hideBanner();
      loadGTM();
    });
    document.getElementById("cookieReject").addEventListener("click", function () {
      setConsent("rejected");
      hideBanner();
    });
  }

  function init() {
    var consent = getConsent();
    if (consent === "accepted") {
      loadGTM();
    } else if (consent !== "rejected") {
      showBanner();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Permite reabrir el banner desde el link "Preferencias de cookies" del footer.
  window.reopenCookieBanner = showBanner;
})();
