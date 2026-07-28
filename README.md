# Bot de WhatsApp con Claude

Bot de atención al cliente para WhatsApp: responde preguntas frecuentes,
agenda/cancela citas en Google Calendar y envía recordatorios automáticos.

**Stack:** Node.js + TypeScript, WhatsApp Cloud API (oficial de Meta), Claude
(Anthropic API) con tool-use, Google Calendar como fuente de verdad de citas
(sin base de datos), desplegado en Railway.

---

## 1. Antes de tocar código: cuenta de WhatsApp Business API

Esto es lo que más tiempo toma (revisión de Meta), así que empieza por aquí.

1. **Cuenta de Meta Business** — crea una en [business.facebook.com](https://business.facebook.com) si no tienen una para el negocio.
2. **App de Meta for Developers** — entra a [developers.facebook.com/apps](https://developers.facebook.com/apps), crea una App de tipo "Business", y añade el producto **WhatsApp**.
3. En el panel de **WhatsApp > API Setup** vas a obtener:
   - Un **número de prueba** gratis para testear de inmediato (limitado a números verificados manualmente), o
   - Puedes verificar el **número real del negocio** (requiere el número, no puede estar ya en uso en la app normal de WhatsApp).
4. Copia el **Temporary access token** (dura 24h, sirve para probar) y el **Phone Number ID** — van en tu `.env`.
5. Para producción necesitas un **token permanente**: Meta Business Manager > System Users > crea un usuario de sistema > genera un token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
6. **Plantilla de recordatorio** (necesaria para los recordatorios automáticos, ver sección 5): en WhatsApp Manager > Plantillas de mensajes, crea una plantilla categoría *Utility* con variables, por ejemplo:
   > Hola {{1}}, te recordamos tu cita de {{2}} el {{3}}. ¡Te esperamos!

   Meta la revisa en horas o pocos días. El nombre que le pongas va en `WHATSAPP_REMINDER_TEMPLATE`.

7. **Plantilla de escalamiento** (necesaria para que Joselyn reciba la notificación automática cuando el bot escala un caso — ver sección 5.1): crea otra plantilla categoría *Utility*, por ejemplo:
   > Caso a atender ({{1}}). Cliente: {{2}}. Detalle: {{3}}

   El nombre va en `WHATSAPP_ESCALATION_TEMPLATE`. El número de WhatsApp de Joselyn que recibe estas notificaciones se configura en `src/businessConfig.ts` (`humanContact.whatsappNumber`), no en `.env`.

   **Importante:** para que Joselyn pueda recibir estos mensajes de plantilla, su número debe estar dado de alta como destinatario válido igual que cualquier otro contacto de WhatsApp Cloud API (si usan el número de prueba, hay que agregarla como "recipient" verificado en el panel de Meta; con un número de producción normal no hace falta este paso).

---

## 2. Google Calendar (cuenta de servicio)

No usamos OAuth de usuario — usamos una **cuenta de servicio** que tu esposa
comparte con su calendario, así el bot puede leer/escribir citas sin que
nadie tenga que "iniciar sesión" nunca.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com), crea un proyecto (o usa uno existente).
2. Habilita la **Google Calendar API** (APIs & Services > Library).
3. Ve a **IAM & Admin > Service Accounts**, crea una cuenta de servicio.
4. Entra a la cuenta creada > **Keys > Add Key > JSON** — descarga el archivo.
5. Guarda ese archivo como `google-service-account.json` en la raíz del proyecto (ya está en `.gitignore`, no se sube al repo).
6. Abre el JSON y copia el valor de `client_email` (algo como `bot@proyecto.iam.gserviceaccount.com`).
7. En Google Calendar (la cuenta de tu esposa), ve a **Configuración del calendario > Compartir con determinadas personas**, añade ese email con permiso **"Realizar cambios en los eventos"**.
8. El ID del calendario (`GOOGLE_CALENDAR_ID`) normalmente es su email de Gmail, o lo encuentras en Configuración del calendario > "Integrar calendario" > ID del calendario.

---

## 3. Configurar el proyecto

```bash
npm install
cp .env.example .env
```

> Si `npm install` falla porque alguna versión de un paquete ya no existe,
> corre `npm install @anthropic-ai/sdk@latest googleapis@latest` para tomar
> las versiones más recientes (las que dejé en `package.json` son un punto
> de partida conservador, no exigen ninguna versión exacta).

Edita `.env` con:
- `ANTHROPIC_API_KEY` — tu clave de la API de Anthropic (console.anthropic.com)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — del paso 1
- `WHATSAPP_VERIFY_TOKEN` — cualquier string secreto que inventes tú (lo vuelves a usar al configurar el webhook en Meta)
- `GOOGLE_CALENDAR_ID` — del paso 2
- `BUSINESS_TIMEZONE` — zona horaria IANA del negocio (ej. `America/Caracas`)

**Edita [`src/businessConfig.ts`](src/businessConfig.ts)** con los datos reales:
nombre del negocio, horario de atención, servicios y precios, preguntas
frecuentes, y el contacto humano para escalar. Todo ese archivo se usa para
armar las instrucciones que sigue Claude — entre más completo y preciso,
mejor responde el bot. No hace falta tocar ningún otro archivo para cambiar
el comportamiento del bot con el día a día del negocio.

---

## 4. Probar en local

### 4.0 Simulador sin costo (sin API key, sin .env)

Si todavía no tienes una API key de Anthropic o no quieres gastar nada
mientras revisas el guion, hay un modo simulado que **no llama a Claude en
absoluto** — reconoce palabras clave simples y responde usando los datos de
`businessConfig.ts`:

```bash
npm run chat:mock
```

Prueba escribiendo `hola`, `precios`, `agendar`, `¿cómo se paga?`,
`domicilio`, `queja`. Sirve para revisar el tono, los precios, las FAQ y
cómo se ve el flujo de agendamiento — pero **no es inteligencia real**: solo
reconoce esas palabras clave puntuales, no entiende lenguaje natural como el
bot de verdad. Para eso está el siguiente paso.

### 4.1 Chat de prueba por consola (lo más rápido, con Claude real)

Antes de meterte con Meta y ngrok, puedes hablar con el bot directo desde la
terminal — solo necesitas `ANTHROPIC_API_KEY` en tu `.env` (Google Calendar
es opcional: si no lo configuras, el bot responde FAQ normalmente pero avisa
si intentas agendar una cita):

```bash
npm run chat
```

Escribe como si fueras un cliente y el bot responde igual que lo haría por
WhatsApp (usa el mismo `businessConfig.ts` y las mismas herramientas). Escribe
`salir` o `Ctrl+C` para terminar. Es la forma más rápida de ajustar el tono,
las respuestas de FAQ y el flujo de agendamiento antes de conectar WhatsApp
de verdad.

### 4.2 Probar el webhook real con WhatsApp (ngrok)

```bash
npm run dev
```

Esto levanta el servidor en `http://localhost:3000`. Para que Meta pueda
llamarte necesitas un túnel público — con [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

En Meta for Developers > WhatsApp > Configuration > Webhook, configura:
- **Callback URL:** `https://TU-URL-DE-NGROK.ngrok.app/webhook`
- **Verify token:** el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`
- Suscríbete al campo **`messages`**

Escribe al número de prueba desde tu WhatsApp personal (primero debes
agregarlo como "recipient" verificado en el panel de Meta si usas el número
de prueba gratuito) y deberías ver la conversación fluir.

---

## 5. Cómo funcionan las citas y los recordatorios

- **Sin base de datos**: cada cita es un evento en Google Calendar. El bot
  usa `freebusy` para calcular huecos libres según el horario de atención
  configurado en `businessConfig.ts`.
- **Recordatorios**: un cron job (`REMINDER_CRON_SCHEDULE`, cada 15 min por
  defecto) busca citas dentro de las próximas `REMINDER_HOURS_BEFORE` horas
  que no tengan el recordatorio marcado como enviado, y envía un mensaje de
  **plantilla** de WhatsApp (obligatorio para mensajes iniciados por el
  negocio fuera de la ventana de 24h de conversación). El estado "enviado"
  se guarda directamente en el evento de Calendar (`extendedProperties`),
  así que no se duplica aunque el bot se reinicie.
- **Historial de conversación**: vive en memoria del proceso (se resetea si
  el bot se reinicia). Es una simplificación intencional — si el negocio
  crece y esto se vuelve un problema, el siguiente paso natural es mover
  `conversationStore.ts` a Redis o Postgres.

### 5.1 Notificaciones a Joselyn

Joselyn recibe una notificación automática por WhatsApp (mensaje de
**plantilla**, misma `WHATSAPP_ESCALATION_TEMPLATE`) en dos situaciones:

1. **Cada vez que se agenda una cita** — como el abono del 20% se coordina
   con atención personal, apenas el bot confirma un horario (`book_appointment`)
   el sistema le avisa automáticamente a Joselyn con el servicio, fecha/hora
   y datos del cliente, para que ella se contacte y cobre el abono. Esto pasa
   a nivel de código, no depende de que el modelo "se acuerde" de avisar. El
   evento en Google Calendar además queda marcado como "(pendiente de abono)"
   en el título.
2. **Cuando Claude detecta un caso que debe escalarse** (queja, solicitud a
   domicilio, servicio fuera de catálogo, etc. — criterios exactos en
   `businessConfig.humanContact.escalationInstructions`), llama a la
   herramienta `escalate_to_human` con el motivo, el teléfono del cliente y
   un resumen del caso.

En ambos casos el bot sigue atendiendo al cliente normalmente, avisándole que
Joselyn se pondrá en contacto.

---

## 6. Desplegar en Railway

1. Sube este proyecto a un repositorio de GitHub (recuerda que `.env` y
   `google-service-account.json` NO se suben — están en `.gitignore`).
2. En [railway.app](https://railway.app), crea un nuevo proyecto desde ese repo.
3. En **Variables**, copia todas las variables de tu `.env` (Railway las
   inyecta como variables de entorno reales).
4. Para el JSON de la cuenta de servicio de Google, la forma más simple en
   Railway es pegar su contenido completo en una variable de entorno
   (ej. `GOOGLE_SERVICE_ACCOUNT_JSON`) y ajustar `src/calendar.ts` para leer
   de ahí en vez de un archivo — o usar un [Volume](https://docs.railway.com/reference/volumes)
   de Railway para montar el archivo. Dime si quieres que lo dejemos listo
   así antes de desplegar.
5. Railway detecta el `package.json` y corre `npm run build` seguido de
   `npm start` automáticamente (usa el `Procfile`/`railway.json` si quieres
   forzarlo explícitamente).
6. Cuando tengas la URL pública de Railway, actualiza el **Callback URL**
   del webhook en Meta for Developers apuntando a
   `https://tu-proyecto.up.railway.app/webhook`.

---

## 7. Costos a tener en cuenta

- **Claude API**: por defecto usa `claude-opus-4-8` (el más capaz). Si el
  volumen de mensajes es alto y el costo importa más que la calidad máxima,
  cambia `CLAUDE_MODEL` en `.env` a `claude-sonnet-5` (buen balance) o
  `claude-haiku-4-5` (el más económico) — no requiere cambios de código.
- **WhatsApp Cloud API**: las conversaciones iniciadas por el negocio
  (recordatorios) tienen costo por plantilla enviada; las respuestas dentro
  de las 24h de que el cliente escribe son gratis en la mayoría de países.
  Revisa el [pricing de Meta](https://developers.facebook.com/docs/whatsapp/pricing) para tu región.
- **Google Calendar API**: gratis dentro de los límites normales de uso.
- **Railway**: tiene un plan gratuito limitado; un bot de bajo/medio tráfico
  cabe cómodamente en el plan de $5/mes.

---

## Estructura del proyecto

```
src/
  businessConfig.ts   # ← EDITA ESTO con los datos reales del negocio
  config.ts            # Carga de variables de entorno
  whatsapp.ts           # Cliente de WhatsApp Cloud API (enviar/recibir)
  calendar.ts            # Integración con Google Calendar
  claude.ts                # Lógica de Claude + herramientas (tools)
  conversationStore.ts       # Historial de conversación en memoria
  reminders.ts                 # Cron job de recordatorios
  server.ts                      # Servidor Express (webhook)
```
