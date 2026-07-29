# Guía paso a paso: cómo se construyó este proyecto

Este documento explica, en orden, todo lo que se hizo para pasar de "no tengo
página web" a lo que tienes hoy: landing page + sistema de reservas + panel
de administrador, todo subido a GitHub. La idea es que puedas repetir el
proceso tú mismo en un proyecto futuro, o entender qué tocar si quieres
seguir modificando este.

---

## 1. Punto de partida

Ya existía un proyecto de Node.js + TypeScript (el bot de WhatsApp), con:
```
src/            # código del bot
package.json
tsconfig.json
.env.example
.gitignore
```
No había ninguna carpeta de sitio web todavía. Antes de escribir código, se
definieron dos cosas con preguntas simples:
- **Tipo de página**: landing page de cara al cliente (no un panel interno).
- **Stack**: HTML/CSS/JS simple, sin framework ni build — el sitio más
  simple posible para lo que se necesitaba.

**Lección para la próxima vez:** antes de picar código, decide en una frase
qué es la página y con qué tecnología la vas a hacer. Evita perder tiempo
más adelante.

---

## 2. Landing page — estructura de archivos

Se creó una carpeta `web/` (separada de `src/`, que es el código del bot)
con tres archivos:
```
web/
  index.html   ← contenido y estructura
  styles.css   ← todo el diseño
  script.js    ← pequeñas interacciones (carrusel, formulario, año del footer)
```
Nada de build, nada de npm packages para el frontend — se abre directo en
el navegador o se sirve como archivos estáticos.

---

## 3. Paleta de colores y tipografía con variables CSS

En vez de escribir colores sueltos por todo el CSS (`#b8635a` aquí, `#b8635a`
allá), se definieron **variables CSS** una sola vez arriba del archivo:

```css
:root {
  --color-bg: #F4D3BE;
  --color-bg-alt: #ecc0a3;
  --color-ink: #3a2a28;
  --color-ink-soft: #6f5b57;
  --color-primary: #b8635a;
  --color-primary-dark: #9c4d45;
  --color-accent: #d9a441;
  --color-card: #ffffff;
  --color-border: #e8dad4;
  --radius: 16px;
  --font-display: "Cormorant Garamond", serif;
  --font-body: "Manrope", system-ui, sans-serif;
}
```

Después, en cualquier parte del CSS se usa `var(--color-primary)` en vez del
código de color. **Ventaja clave:** cuando pediste cambiar el fondo (varias
veces — DarkSalmon, luego FFB8BC, luego F4D3BE), solo hubo que cambiar el
valor de `--color-bg` en un solo lugar, y todo el sitio se actualizó solo.

Las tipografías se cargan desde Google Fonts en el `<head>` del HTML:
```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@300;400;500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```
- **Cormorant Garamond**: la serif elegante para títulos.
- **Jost**: la sans-serif geométrica para el nombre de marca (buscando
  parecerse al logo real).
- **Manrope**: la tipografía de lectura para párrafos y botones.

---

## 4. Construir las secciones de la landing page

Cada sección del sitio es un `<section>` con un `id` (para los links del
menú tipo `#servicios`) y una clase `section` o `section-alt` (para
alternar el color de fondo). El patrón se repite:

```html
<section id="servicios" class="section">
  <div class="container">
    <h2>Título de la sección</h2>
    <p class="section-sub">Texto de apoyo.</p>
    ... contenido específico ...
  </div>
</section>
```

Secciones que se construyeron, en orden de aparición:
1. **Hero** (título principal + CTA)
2. **Servicios y precios** (acordeones — ver punto 5)
3. **Galería** (carrusel de fotos — ver punto 6)
4. **Un poco de mí** (teaser + link a página aparte)
5. **Reserva tu hora** (formulario — ver punto 7)
6. **Horario** (con tarjeta de info + iconos SVG)
7. **Preguntas frecuentes** (usando `<details>`/`<summary>`, sin JavaScript)
8. **Contacto / CTA final**

**Truco usado para las FAQ y los acordeones de servicios:** el elemento
HTML nativo `<details>` con `<summary>` se abre/cierra solo, sin escribir
ni una línea de JavaScript:
```html
<details>
  <summary>¿Cómo se paga?</summary>
  <p>Aceptamos efectivo y transferencia...</p>
</details>
```
El navegador maneja el clic y el abrir/cerrar automáticamente. Solo se
estilizó con CSS (quitando el triangulito por defecto y agregando el
"+"/"–" o la flechita ⌄).

---

## 5. El acordeón de servicios (botones que despliegan precios)

Se pidió que "Servicios y precios" no mostrara todo de un tirón, sino 3
botones (Depilación facial / corporal / Lifting & Browlamination) que al
hacer clic despliegan su lista. Se resolvió con el mismo truco de
`<details>`/`<summary>`, pero estilizando el `<summary>` como un botón
grande en vez de una fila de FAQ:

```html
<details class="service-accordion" open>
  <summary class="service-accordion-btn">
    <span>Depilación facial</span>
    <span class="chevron">⌄</span>
  </summary>
  <ul class="service-list">
    <li><span class="service-name">Perfilado de cejas</span><span class="service-price">$10.000</span></li>
    ...
  </ul>
</details>
```
El CSS le da forma de tarjeta/botón, y una regla rota la flechita 180°
cuando está abierto:
```css
.service-accordion[open] .service-accordion-btn .chevron { transform: rotate(180deg); }
```

---

## 6. El carrusel de fotos (galería)

Es una fila horizontal con scroll nativo del navegador (`overflow-x: auto`
+ `scroll-snap-type: x mandatory`), sin ninguna librería de carruseles:
```css
.carousel-track {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
}
.carousel-slide { flex: 0 0 240px; scroll-snap-align: start; }
```
Las flechitas ‹ › solo llaman a `scrollBy()` en JavaScript:
```js
document.querySelector(".carousel-prev").addEventListener("click", () => {
  carouselTrack.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
});
```
Al principio se usaron tarjetas de relleno (ícono + texto) porque no había
fotos reales todavía. Cuando compartiste las fotos, se reemplazó cada
`<div>` de relleno por un `<img>` real apuntando a `images/nombre-archivo.jpeg`.

---

## 7. Formulario de reserva → correo + base de datos (esto ya es backend)

Aquí el sitio deja de ser "solo HTML" y empieza a necesitar un servidor,
porque un sitio estático no puede enviar correos ni guardar datos por su
cuenta. Como el proyecto ya tenía un servidor Express (`src/server.ts`) para
el bot de WhatsApp, se reutilizó ese mismo servidor.

**Piezas nuevas creadas:**

- **`src/reservationsDb.ts`** — usa el paquete `better-sqlite3` para crear
  un archivo de base de datos (`data/reservations.db`) con una tabla
  `reservations`. Funciones: `saveReservation()`, `listReservations()`,
  `setReservationContacted()`, `deleteReservation()`.

- **`src/mailer.ts`** — usa el paquete `nodemailer` para enviar correos
  con una cuenta de Gmail. Necesita una **"contraseña de aplicación"** de
  16 caracteres (no la contraseña normal de la cuenta), que se genera en
  `myaccount.google.com/apppasswords` después de activar la verificación
  en 2 pasos.

- **En `src/server.ts`**, se agregó una ruta:
  ```ts
  app.post("/api/reservations", async (req, res) => {
    // valida los datos del formulario
    // guarda con saveReservation()
    // envía los correos con sendReservationEmails()
  });
  ```

- **En el HTML/JS del formulario** (`web/index.html` + `web/script.js`), el
  `<form>` no recarga la página — un listener de JavaScript intercepta el
  `submit`, arma un JSON y lo manda con `fetch()`:
  ```js
  const response = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  ```

- **Variables nuevas en `.env`**: `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
  `OWNER_NOTIFICATION_EMAIL`, `RESERVATIONS_DB_PATH`.

**Para que el navegador y el servidor "se hablen" sin problemas de
permisos (CORS)**, se hizo que el mismo servidor Express sirviera también
la carpeta `web/` como sitio estático:
```ts
app.use(express.static(path.join(__dirname, "../web")));
```
Así, visitando `http://localhost:3000` (o la URL de Railway en producción)
se ve la landing page Y el formulario le puede hablar al backend en el
mismo dominio.

---

## 8. Panel de administrador (`/admin`)

Para ver/gestionar las reservas sin abrir la base de datos a mano, se creó:

- **`admin/` (carpeta aparte, NO dentro de `web/`)** — un `index.html` +
  `styles.css` + `script.js` propio, muy simple: una tabla que carga las
  reservas con `fetch("/admin/api/reservations")` y permite marcar
  "contactada" o eliminar.

- **Protección con usuario/contraseña (HTTP Basic Auth)** en
  `src/server.ts`: un middleware `requireAdminAuth` que revisa el header
  `Authorization` de cada request contra `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  del `.env`. Si no coinciden, responde `401` y el navegador muestra el
  clásico cuadro de "usuario y contraseña".
  ```ts
  app.use("/admin", requireAdminAuth, express.static(path.join(__dirname, "../admin")));
  ```

**Por qué en una carpeta aparte de `web/`:** si el panel estuviera dentro
de `web/`, quedaría servido públicamente sin contraseña por el
`express.static` del sitio principal. Ponerlo en su propia carpeta,
protegida explícitamente, evita ese error.

---

## 9. Fotos y assets (`web/images/`)

Las fotos que compartiste se guardaron en `web/images/`, y cada `<img>` o
`background-image` del CSS apunta a `images/nombre-del-archivo.jpeg`.

**Detalle importante que se corrigió:** la carpeta se llamaba `Images`
(con mayúscula) en el disco, pero el código la referenciaba como `images`
(minúscula). Windows no distingue mayúsculas de minúsculas, así que
funcionaba en local — pero un servidor Linux (como Railway) sí distingue,
así que se habría roto en producción. Se corrigió renombrando la carpeta a
minúscula antes de subir el proyecto.

**Lección:** en proyectos web, usa siempre el mismo "casing" (mayúsculas/
minúsculas) entre el nombre real del archivo y como lo escribes en el
código — y pruébalo idealmente en un sistema que sí distinga mayúsculas
antes de desplegar.

---

## 10. Git y GitHub

Pasos que corriste tú mismo en la terminal (repetibles para cualquier
proyecto nuevo):

```bash
cd "ruta\del\proyecto"
git init                          # crea el repositorio local
git add .                         # marca los archivos para el commit
git commit -m "mensaje"           # guarda una "foto" del código
git branch -M main                # nombra la rama principal
git remote add origin <URL>       # conecta con el repo vacío de GitHub
git push -u origin main           # sube todo por primera vez
```

Para cambios posteriores, el ciclo se repite pero más corto:
```bash
git add .
git commit -m "descripción del cambio"
git push
```

**Cosas que fallaron en el camino y cómo se resolvieron** (útil si te
vuelve a pasar):
- Escribir la ruta del `git remote add origin` con un placeholder literal
  (`TU-USUARIO`) en vez del usuario real → se corrigió con
  `git remote set-url origin <url-correcta>`.
- `npm`/`node` no reconocidos en una terminal nueva → el Node.js estaba
  instalado vía **fnm** (gestor de versiones), que hay que activar en cada
  ventana nueva con `fnm env --use-on-cd | Out-String | Invoke-Expression`
  seguido de `fnm use default` (o dejarlo configurado permanentemente en el
  perfil de PowerShell).
- Guardar cambios en `.env` no reinicia el servidor solo — hay que parar
  (`Ctrl+C`) y volver a correr `npm run dev` para que tome las variables
  nuevas.

---

## 11. Resumen del flujo para la próxima vez

1. Define en una frase qué página necesitas y con qué stack.
2. Crea la estructura de carpetas (`web/` para frontend estático, o lo que
   corresponda).
3. Define tu paleta de colores como variables CSS *antes* de escribir el
   resto del diseño — te ahorra reescribir todo cuando cambies de opinión.
4. Construye sección por sección, probando en el navegador después de cada
   cambio importante.
5. Si necesitas guardar datos o enviar correos, ahí recién entra un
   backend (Node/Express en este caso) — un sitio 100% estático no puede
   hacer eso por sí solo.
6. Sube a GitHub temprano y sigue el ciclo `add` → `commit` → `push` cada
   vez que tengas un avance que valga la pena guardar.
