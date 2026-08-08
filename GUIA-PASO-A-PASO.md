# Depicejas Beyond Beauty — Guía completa del proyecto

Documento del paso a paso de cómo se construyó y publicó el sitio web de
**Depicejas Beyond Beauty**, desde que no existía nada hasta tenerlo en
producción con dominio propio.

Sirve para dos cosas: entender qué tocar si quieres seguir modificando este
proyecto, y repetir el proceso en un proyecto futuro.

**Resultado final:**
- Sitio público: `https://depicejas.ooli.uk`
- Panel de reservas: `https://depicejas.ooli.uk/admin` (con contraseña)
- Repositorio: `github.com/Oskrjc/ws-depicejas-bot`
- Hosting: Railway · DNS: Cloudflare · Pagos: MercadoPago (Checkout Pro)

---

# FASE 0 — Punto de partida y decisiones

Ya existía un proyecto de Node.js + TypeScript (el bot de WhatsApp con
Claude), con esta estructura:

```
src/              # código del bot
package.json
tsconfig.json
.env.example
.gitignore
```

No había ninguna carpeta de sitio web. Antes de escribir código se
definieron dos cosas:

- **Tipo de página**: landing page de cara al cliente (no un panel interno).
- **Stack**: HTML/CSS/JS simple, sin framework ni build.

> **Lección:** antes de picar código, define en una frase qué es la página y
> con qué tecnología la vas a hacer. Evita rehacer trabajo después.

---

# FASE 1 — Landing page estática

## 1.1 Estructura de archivos

Se creó una carpeta `web/` (separada de `src/`, que es el código del bot):

```
web/
  index.html   ← contenido y estructura
  styles.css   ← todo el diseño
  script.js    ← interacciones (carrusel, formulario, año del footer)
  images/      ← fotos del negocio
```

Sin build, sin paquetes npm para el frontend. Se abre directo en el
navegador o se sirve como archivos estáticos.

## 1.2 Paleta de colores y tipografía con variables CSS

En vez de repetir colores por todo el CSS, se definieron **variables** una
sola vez arriba del archivo:

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

Después, en todo el CSS se usa `var(--color-primary)` en vez del código de
color.

> **Por qué importa:** el fondo se cambió tres veces durante el proyecto
> (DarkSalmon → #FFB8BC → #F4D3BE). Con variables, cada cambio fue editar
> **una línea** y todo el sitio se actualizó solo.

Las tipografías se cargan desde Google Fonts en el `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@300;400;500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- **Cormorant Garamond** — serif elegante para títulos.
- **Jost** — sans-serif geométrica para el nombre de marca (imita el logo).
- **Manrope** — tipografía de lectura para párrafos y botones.

## 1.3 Patrón de las secciones

Cada sección es un `<section>` con un `id` (para los links del menú tipo
`#servicios`) y una clase `section` o `section-alt` (para alternar el fondo):

```html
<section id="servicios" class="section">
  <div class="container">
    <h2>Título de la sección</h2>
    <p class="section-sub">Texto de apoyo.</p>
    ... contenido específico ...
  </div>
</section>
```

Secciones construidas, en orden:

1. **Hero** — título principal sobre foto de fondo, texto centrado
2. **Servicios y precios** — acordeones (ver 1.4)
3. **Galería** — carrusel de fotos (ver 1.5)
4. **Reserva tu hora** — formulario (ver Fase 2)
5. **Horario** — con tarjeta de info e iconos SVG
6. **Preguntas frecuentes** — `<details>`/`<summary>`, sin JavaScript
7. **Contacto / CTA final**

## 1.4 Acordeones de servicios (sin JavaScript)

Se pedía que "Servicios y precios" mostrara 3 botones que al hacer click
desplegaran su lista. Se resolvió con el elemento HTML nativo
`<details>`/`<summary>`, que se abre y cierra solo:

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

El CSS le da forma de botón y rota la flechita cuando está abierto:

```css
.service-accordion[open] .service-accordion-btn .chevron { transform: rotate(180deg); }
```

El mismo truco se usó para las FAQ.

> **Bug encontrado y corregido:** las reglas CSS de `details`/`summary`
> estaban escritas de forma genérica (para las FAQ) y se "colaban" también
> en los acordeones de servicios, duplicando el padding y mostrando un "+"
> de más. Se corrigió acotando los selectores a `.faq-list details`.
> **Lección:** cuando uses un elemento HTML genérico en varios lugares,
> acota los estilos con una clase padre.

## 1.5 Carrusel de fotos (sin librerías)

Es una fila con scroll horizontal nativo del navegador:

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

Las flechas ‹ › solo llaman a `scrollBy()`:

```js
document.querySelector(".carousel-prev").addEventListener("click", () => {
  carouselTrack.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
});
```

Al principio se usaron tarjetas de relleno (ícono + texto) porque no había
fotos reales. Cuando llegaron las fotos, se reemplazó cada tarjeta por un
`<img>` con `object-fit: cover` para que todas se recorten parejo.

---

# FASE 2 — Backend: reservas por correo + base de datos

Aquí el sitio deja de ser "solo HTML". Un sitio estático **no puede** enviar
correos ni guardar datos. Como el proyecto ya tenía un servidor Express
(`src/server.ts`) para el bot, se reutilizó ese mismo servidor.

## 2.1 Piezas nuevas

**`src/reservationsDb.ts`** — usa `better-sqlite3` para crear un archivo de
base de datos con la tabla `reservations`. Funciones expuestas:
`saveReservation()`, `listReservations()`, `setReservationContacted()`,
`deleteReservation()`.

**`src/mailer.ts`** — usa `nodemailer` para enviar correos con Gmail.
Envía dos correos por reserva: uno interno con los datos, y uno de
confirmación al cliente.

**Ruta nueva en `src/server.ts`:**

```ts
app.post("/api/reservations", async (req, res) => {
  // valida los datos del formulario
  // guarda con saveReservation()
  // envía los correos con sendReservationEmails()
});
```

**En el frontend** (`web/script.js`), el formulario no recarga la página —
un listener intercepta el `submit` y manda un JSON con `fetch()`:

```js
const response = await fetch("/api/reservations", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

## 2.2 Servir el sitio desde el mismo servidor

Para que el navegador y el backend estén en el mismo dominio (y no haya
problemas de CORS), Express también sirve la carpeta `web/`:

```ts
app.use(express.static(path.join(__dirname, "../web")));
```

Así, `http://localhost:3000` muestra la landing page **y** el formulario
puede hablarle al backend sin configuración extra.

## 2.3 Configurar el envío de correos con Gmail

Gmail no acepta la contraseña normal de la cuenta desde una aplicación.
Hay que generar una **contraseña de aplicación**:

1. Entra a [myaccount.google.com/security](https://myaccount.google.com/security)
2. Activa la **Verificación en 2 pasos** (es requisito — sin esto, la opción
   de contraseñas de aplicación **no aparece**).
3. Ve a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
4. Crea una nueva y copia el código de **16 caracteres**.

Variables agregadas al `.env`:

```
GMAIL_USER=Depicejas.cl@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
OWNER_NOTIFICATION_EMAIL=Depicejas.cl@gmail.com
RESERVATIONS_DB_PATH=./data/reservations.db
```

> ⚠️ El archivo `.env` **nunca** se sube al repositorio (está en
> `.gitignore`). Tampoco compartas capturas de pantalla de él.

---

# FASE 3 — Panel de administrador

Para ver y gestionar las reservas sin abrir la base de datos a mano.

## 3.1 Archivos

Se creó una carpeta **`admin/` aparte de `web/`**:

```
admin/
  index.html   # tabla de reservas
  styles.css
  script.js    # carga los datos vía fetch, marca contactada, elimina
```

> **Por qué en carpeta aparte:** si estuviera dentro de `web/`, el
> `express.static` del sitio público la serviría **sin contraseña**.
> Ponerla en su propia carpeta protegida evita ese error de seguridad.

## 3.2 Protección con usuario y contraseña

Un middleware de autenticación básica (HTTP Basic Auth) en `src/server.ts`:

```ts
app.use("/admin", requireAdminAuth, express.static(path.join(__dirname, "../admin")));
```

`requireAdminAuth` compara contra `ADMIN_USERNAME` y `ADMIN_PASSWORD` del
`.env`. Si no coinciden, responde `401` y el navegador muestra el cuadro de
login. Si `ADMIN_PASSWORD` está vacío, el panel se desactiva por completo
(error 503) para que nunca quede accidentalmente abierto.

Las rutas de la API (`/admin/api/reservations`) también están protegidas
individualmente, no solo los archivos.

---

# FASE 4 — Contenido de marca

## 4.1 Fotos

Las fotos se guardaron en `web/images/`, y cada `<img>` o `background-image`
apunta a `images/nombre-archivo.jpeg`.

> ⚠️ **Lección de seguridad:** en un momento se subió por error un PDF con
> datos personales a `web/images/`. Todo lo que esté en `web/` queda
> **público en internet** cuando despliegas. Revisa siempre qué archivos
> hay en esa carpeta antes de publicar.

> ⚠️ **Lección técnica (mayúsculas/minúsculas):** la carpeta se llamaba
> `Images` en el disco pero el código la referenciaba como `images`.
> Windows no distingue mayúsculas, así que funcionaba en local — pero
> **Linux sí distingue**, y en Railway todas las fotos se habrían roto.
> Se renombró a minúscula antes de desplegar. Usa siempre el mismo
> "casing" entre el archivo real y el código.

## 4.2 Segunda página: "Un poco de mí"

Se creó `web/sobre-mi.html` como **página separada** (no una sección de la
home), con la historia del emprendimiento. Detalles:

- Reutiliza el mismo `styles.css` — no hay CSS duplicado.
- El link en el menú es `sobre-mi.html`; los links a secciones de la home
  desde ahí son `index.html#servicios`, etc.
- Se le dio estilo distinto al link del menú (`.nav-story`) para que
  destaque: tipografía serif itálica dentro de una píldora con borde.

## 4.3 Botones flotantes de WhatsApp e Instagram

Fijos en la esquina inferior derecha, presentes en ambas páginas:

```css
.floating-actions {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
```

Los íconos son **SVG inline** (el logo real de cada marca), no emojis. El de
WhatsApp usa el link `https://wa.me/<numero>?text=<mensaje-precargado>`, con
el número en formato internacional sin `+` ni espacios.

---

# FASE 5 — Control de versiones (Git + GitHub)

## 5.1 Primera vez (proyecto nuevo)

1. Crea el repositorio **vacío** en GitHub (sin README, sin .gitignore, sin
   licencia — el código local ya los tiene).
2. En la terminal, dentro de la carpeta del proyecto:

```bash
git init                          # crea el repositorio local
git status                        # revisa que NO aparezca .env ni credenciales
git add .                         # marca los archivos para el commit
git commit -m "Initial commit"    # guarda una "foto" del código
git branch -M main                # nombra la rama principal
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main           # sube todo por primera vez
```

## 5.2 Ciclo normal (cada cambio posterior)

```bash
git add .
git commit -m "descripción del cambio"
git push
```

## 5.3 Qué NUNCA se sube

El `.gitignore` del proyecto excluye:

```
node_modules/
dist/
.env
google-service-account.json
*.log
data/          ← la base de datos de reservas
```

---

# FASE 6 — Despliegue a producción (Railway)

## 6.1 Por qué Railway y no Cloudflare Pages

Se intentó primero con **Cloudflare Pages** y no funcionó. La razón:
Cloudflare Pages solo sirve **archivos estáticos** — no ejecuta Node.js. Con
él, el formulario de reservas y el panel `/admin` no funcionarían.

**Regla general:**
- Sitio 100% estático (solo HTML/CSS/JS) → Cloudflare Pages, Netlify, GitHub Pages
- Sitio con backend (base de datos, correos, login) → Railway, Render, Fly.io

## 6.2 Crear el proyecto en Railway

1. Entra a [railway.app](https://railway.app) y crea cuenta (puedes usar GitHub).
2. **New Project** → **Deploy from GitHub repo** → selecciona el repositorio.
3. Railway detecta el `package.json` y corre `npm run build` + `npm start`
   automáticamente.

## 6.3 Variables de entorno

En la pestaña **Variables** del servicio, agrega todas las del `.env` local.

> ⚠️ **Error real encontrado:** el traductor automático de Chrome estaba
> traduciendo la interfaz de Railway, mostrando `ANTHROPIC_API_KEY` como
> `CLAVE_API_ANTRÓPICA` y "Railway" como "Ferrocarril". Los nombres de las
> variables **deben ser exactos en inglés** o la app no arranca.
> **Desactiva la traducción de la página** antes de configurarlas.

> **Nota sobre `PORT`:** no la definas manualmente. Railway asigna el puerto
> automáticamente y el código lo lee con `process.env.PORT`. Si la fuerzas a
> 3000, el sitio puede dar error 502.

## 6.4 Volumen para la base de datos (crítico)

El disco de un contenedor es **temporal**: se borra en cada redespliegue.
Sin un volumen, **todas las reservas se pierden cada vez que haces `git push`**.

1. En el lienzo de Railway, click derecho → **Volume** (o `Ctrl + K` → "volume").
2. Adjúntalo al servicio.
3. **Mount path:** `/data`
4. Cambia la variable `RESERVATIONS_DB_PATH` a **`/data/reservations.db`**

> ⚠️ El detalle que se pasa por alto: debe ser la ruta **absoluta**
> `/data/reservations.db`. Si la dejas como `./data/reservations.db` (con
> punto), apunta al disco temporal del contenedor y el volumen no sirve.

## 6.5 Verificar

En **Settings → Networking → Public Networking**, click en
**Generate Domain**. Railway da una URL tipo
`ws-depicejas-bot-production.up.railway.app`.

Checklist de verificación:
- [ ] La landing page carga con las fotos
- [ ] `/admin` pide usuario y contraseña
- [ ] Enviar una reserva de prueba → llegan los dos correos
- [ ] La reserva aparece en el panel

---

# FASE 7 — Dominio propio y DNS (Cloudflare)

## 7.1 Agregar el dominio en Railway

**Settings → Public Networking → + Custom Domain** → escribe el dominio
(en este caso `depicejas.ooli.uk`). Railway devuelve un registro **CNAME**
con un valor tipo `v3niwzou.up.railway.app`.

> ⚠️ **Límite del plan de prueba:** Railway solo permite **1 dominio
> personalizado por servicio** en el plan gratuito. Si el botón aparece
> deshabilitado, es porque ya tienes uno — bórralo o pasa al plan Hobby.

## 7.2 Configurar el DNS en Cloudflare

1. Cloudflare → tu dominio → **DNS → Records → Add record**
2. Llena:
   - **Type:** `CNAME`
   - **Name:** `depicejas` ← solo el subdominio, no el dominio completo
     (usa `@` si quieres el dominio raíz)
   - **Target:** el valor que dio Railway
   - **Proxy status:** nube **gris (DNS only)** mientras Railway emite el
     certificado SSL
3. Guarda y espera entre 2 minutos y 1 hora.

## 7.3 Problemas comunes de DNS

| Error | Causa | Solución |
|---|---|---|
| "A record with that host already exists" | Ya existe un CNAME con ese nombre | Cancela, revisa la lista y edita/elimina el duplicado en vez de crear otro |
| Railway dice "Cloudflare proxy detected" | La nube está naranja | Ponla gris, o si la quieres naranja, cambia SSL/TLS a modo **Full** (no "Flexible", que causa bucles de redirección) |
| El sitio no carga después de 1 hora | DNS mal escrito o proxy mal configurado | Verifica que el Target sea exactamente el de Railway |

Railway también crea registros `TXT` de verificación (`_railway-verify.*`).
No los borres.

---

# FASE 8 — Ciclo de actualización continua

Una vez todo está en producción, actualizar el sitio es simple porque
Railway está conectado a GitHub con despliegue automático:

```
1. Editas los archivos localmente
2. git add .
3. git commit -m "descripción"
4. git push
5. Railway detecta el push y redespliega solo (1-2 min)
6. Ctrl + F5 en el navegador para ver los cambios
```

Si algo sigue apareciendo viejo, Cloudflare puede estar cacheando:
**Caching → Configuration → Purge Everything**.

---

# FASE 9 — Pago online con MercadoPago

El formulario de reservas dejó de ser "solo una solicitud": ahora el cliente
elige pagar **el abono del 20% o el valor completo del servicio** al momento
de reservar, antes de que Joselyn confirme el horario definitivo (el
selector está en el propio formulario). El pago por WhatsApp (coordinado a
mano) **no cambió** — esto es independiente y solo aplica al formulario de
la web.

## 9.1 Por qué Checkout Pro (y no manejar tarjetas nosotros)

MercadoPago ofrece varias formas de integrarse. Se eligió **Checkout Pro**:
el cliente se redirige a una página de pago hospedada por MercadoPago, paga
ahí, y vuelve a nuestro sitio. Nuestro servidor nunca ve ni toca datos de
tarjetas — MercadoPago se encarga de la seguridad (PCI compliance) por
completo. La alternativa (Checkout API / "Bricks") deja el formulario de
pago embebido en nuestro sitio, pero exige mucho más trabajo de seguridad
para poco beneficio en un sitio de este tamaño.

## 9.2 Crear la cuenta y sacar las credenciales

1. Crea una cuenta en [mercadopago.cl](https://www.mercadopago.cl) (si el
   negocio no tiene una todavía) — es la cuenta que va a recibir el dinero.
2. Entra a [mercadopago.cl/developers/panel](https://www.mercadopago.cl/developers/panel/app) y crea una aplicación
   ("Crear aplicación").
3. Dentro de la app, ve a **Credenciales de producción** y copia el
   **Access Token** (empieza con `APP_USR-...`). Este es el que cobra plata
   de verdad — guárdalo con cuidado, nunca lo subas al repositorio.
4. Para probar sin arriesgar dinero real, usa en cambio las
   **Credenciales de prueba** (misma pantalla) — el Access Token empieza
   con `TEST-...`. Con ese token, MercadoPago simula el pago sin cobrar nada.

> ⚠️ **No hace falta activar cobros para probar.** Puedes desarrollar y
> probar todo el flujo con el Access Token de prueba (`TEST-...`) antes de
> siquiera pensar en activar cobros reales de la cuenta.

## 9.3 Variables nuevas en `.env`

```
MERCADOPAGO_ACCESS_TOKEN=TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxx
BASE_URL=
```

- **`MERCADOPAGO_ACCESS_TOKEN`**: el token del paso anterior. Si lo dejas
  vacío, el formulario de la web sigue funcionando pero responde con un
  error claro ("el pago online todavía no está configurado") en vez de
  romperse — así el resto del sitio no se ve afectado mientras configuras
  esto con calma.
- **`BASE_URL`**: la URL pública del sitio, **sin barra al final**. En local
  puedes dejarla vacía (usa `http://localhost:3000` automáticamente). En
  Railway, ponla como `https://depicejas.ooli.uk` — MercadoPago la necesita
  para saber a dónde redirigir al cliente después de pagar, y a dónde
  avisarnos del resultado (el webhook).

## 9.4 Probar con una tarjeta de prueba

Con el Access Token de prueba (`TEST-...`) configurado, MercadoPago te deja
simular pagos con tarjetas de prueba oficiales — hay una lista completa en
[el panel de credenciales de prueba](https://www.mercadopago.cl/developers/panel/app),
sección "Cuentas y tarjetas de prueba". Como referencia, una tarjeta
Mastercard de prueba típica es:

```
Número: 5031 7557 3453 0604
Vencimiento: 11/30
CVV: 123
Nombre del titular: APRO (para que el pago se apruebe automáticamente)
```

> El nombre del titular controla el resultado: `APRO` aprueba el pago,
> `OTHE` lo rechaza, etc. — útil para probar también el flujo de pago
> fallido (`web/reserva-fallida.html`).

## 9.5 Cómo funciona el flujo técnico

```
1. Cliente llena el formulario → POST /api/reservations
2. El servidor guarda la reserva (estado "pending") y crea una
   "preferencia" de pago en MercadoPago con el precio del servicio
3. El servidor responde con la URL de checkout; el navegador redirige
   al cliente a MercadoPago
4. El cliente paga en la página de MercadoPago
5. MercadoPago redirige al cliente de vuelta a una de las tres páginas
   de resultado (reserva-exitosa.html / -pendiente.html / -fallida.html)
6. EN PARALELO, MercadoPago llama a POST /api/payments/webhook —
   esta es la fuente de verdad real, no la redirección del paso 5
   (que puede perderse si el cliente cierra la pestaña antes de tiempo)
7. El webhook consulta el estado real del pago, actualiza la reserva
   en la base de datos, y si el pago fue aprobado, envía los correos
   de confirmación (a Joselyn y al cliente)
```

> **Por qué el webhook y no solo la redirección:** la redirección al
> navegador del cliente (paso 5) no es confiable — el cliente puede cerrar
> la pestaña, perder conexión, o el navegador puede bloquear la vuelta.
> El webhook (paso 6) es una llamada servidor-a-servidor de MercadoPago
> directamente a Railway, así que no depende de que el cliente haga nada.

## 9.6 Desplegar a producción

En Railway, agrega las dos variables nuevas en **Variables**:

```
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...   ← el de producción, cuando estés lista para cobrar de verdad
BASE_URL=https://depicejas.ooli.uk
```

No hace falta registrar manualmente la URL del webhook en ningún panel de
MercadoPago — se manda automáticamente en cada preferencia de pago que crea
el servidor (`notification_url`), apuntando a `BASE_URL` + `/api/payments/webhook`.

Checklist de verificación:
- [ ] Con el token de prueba, hacer una reserva de prueba y pagar con la
  tarjeta `APRO` → debe llegar a `reserva-exitosa.html` y, unos segundos
  después, llegar el correo de "pago recibido"
- [ ] La reserva de prueba aparece en `/admin` con el badge verde "Pagado"
- [ ] Probar también un pago rechazado (tarjeta `OTHE`) → debe llegar a
  `reserva-fallida.html`
- [ ] Cuando el negocio esté listo para cobrar de verdad, cambiar
  `MERCADOPAGO_ACCESS_TOKEN` al de producción (`APP_USR-...`)

---

# ANEXO A — Errores encontrados y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| `npm` / `node` no reconocidos | Node instalado vía **fnm**, que no se activa solo en cada terminal | `fnm env --use-on-cd \| Out-String \| Invoke-Expression` y luego `fnm use default` |
| `git remote add origin` con `TU-USUARIO` | Se copió el ejemplo literal | `git remote set-url origin <url-real>` |
| Cambios en `.env` no se aplican | `ts-node-dev` solo reinicia con cambios en `.ts` | Detener con `Ctrl+C` y volver a correr `npm run dev` |
| `Cannot find module 'better-sqlite3'` | Dependencias nuevas sin instalar | `npm install` |
| Fotos rotas en producción | Carpeta `Images` vs código `images` | Linux distingue mayúsculas — unificar el casing |
| Variables de Railway con nombres raros | Traductor de Chrome activo | Desactivar traducción de la página |
| Botón "Custom Domain" deshabilitado | Límite de 1 dominio en plan de prueba | Borrar el dominio anterior o subir de plan |

---

# ANEXO B — Costos y mantenimiento

| Servicio | Costo | Nota |
|---|---|---|
| **Railway** | US$5/mes (plan Hobby) | La prueba gratuita expira a los 30 días o al gastar US$5. Después de eso, el sitio se cae si no se paga. |
| **Cloudflare DNS** | Gratis | Solo pagas el registro del dominio |
| **Dominio `ooli.uk`** | Ya registrado | Vence Jul 2027, renovación automática activa |
| **Gmail (correos)** | Gratis | Dentro de los límites normales de envío |
| **Claude API** (bot) | Por uso | Solo si activas el bot de WhatsApp |
| **MercadoPago** | Comisión por venta | Cobra un % del monto de cada pago aprobado (varía según medio de pago) — se descuenta automáticamente, no hay costo fijo mensual |

---

# ANEXO C — Estructura final del proyecto

```
src/
  businessConfig.ts     # ← datos del negocio (precios, horario, contacto)
  config.ts             # carga de variables de entorno
  whatsapp.ts           # cliente de WhatsApp Cloud API
  calendar.ts           # integración con Google Calendar
  claude.ts             # lógica del bot + herramientas
  conversationStore.ts  # historial de conversación en memoria
  reminders.ts          # cron job de recordatorios
  reservationsDb.ts     # base de datos SQLite de reservas web + pagos
  mailer.ts             # envío de correos (Gmail)
  mercadopago.ts        # integración de pagos (Checkout Pro)
  server.ts             # Express: webhook + API + pagos + sitio estático + /admin

web/                    # sitio público
  index.html
  sobre-mi.html
  reserva-exitosa.html    # resultado del pago (redirección de MercadoPago)
  reserva-pendiente.html
  reserva-fallida.html
  styles.css
  script.js
  images/

admin/                  # panel de reservas (protegido con contraseña)
  index.html
  styles.css
  script.js
```

---

# ANEXO D — Pendientes / mejoras posibles

- **Bot de WhatsApp:** el código está listo pero falta configurar la cuenta
  de WhatsApp Business API en Meta y la cuenta de servicio de Google
  Calendar (ver secciones 1 y 2 del `README.md`). Al activarlo, el Callback
  URL del webhook debe ser `https://depicejas.ooli.uk/webhook`.
- **MercadoPago:** el código está listo (ver FASE 9) pero falta crear la
  cuenta y configurar `MERCADOPAGO_ACCESS_TOKEN` y `BASE_URL`. Mientras no
  esté configurado, el formulario de reservas responde con un error claro
  en vez de romperse.
- **Dominio con el nombre del negocio:** hoy es `depicejas.ooli.uk`. Comprar
  `depicejascl.com` (~US$11/año) daría una imagen más profesional. Se puede
  agregar sin rehacer nada — solo un "+ Custom Domain" más.
- **Historial de conversación del bot:** vive en memoria, se pierde al
  reiniciar. Si el negocio crece, migrar `conversationStore.ts` a la misma
  base de datos SQLite.
- **Analítica:** no hay ninguna medición de visitas. Cloudflare Analytics
  viene gratis con el dominio y no requiere cambios en el código.
