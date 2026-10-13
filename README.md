# Flock TM MCP

MCP para la gestión de proyectos de un Team Manager en Flock. Tiene dos endpoints:

| Endpoint | Quién | Tools |
|---|---|---|
| `/tm/mcp?key=TM_KEY` | Vos (TM) | Todo lo del equipo + `configure_project`, `find_contract_files`, `read_contract_file`, `save_contract_terms`, `contract_check` |
| `/team/mcp?key=TEAM_KEY` | Equipo | `list_projects`, `save_suggestions`, `list_suggestions`, `update_suggestion`, `approve_suggestion`, `dismiss_suggestion`, `jira_hygiene`, `sprint_velocity`, `board_snapshot` |

Prompts: `post-refinamiento`, `status-semanal` (los dos endpoints) y `chequeo-contrato` (solo el TM).

El equipo nunca ve los montos del contrato. `board_snapshot` solo devuelve las fechas y los días hábiles.

---

## 1. Correrlo en local

```bash
npm install
cp .env.example .env.local      # completá TM_KEY y TEAM_KEY como mínimo
openssl rand -hex 24            # usalo para generar cada clave
npm run dev                     # http://localhost:3000
```

Para probarlo con el Inspector de MCP:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP · URL: http://localhost:3000/tm/mcp?key=TU_TM_KEY
```

Si no configurás Upstash, el storage queda en memoria y se borra cada vez que reiniciás.

---

## 2. Credenciales

### Jira (API token)

1. Entrá a https://id.atlassian.com/manage-profile/security/api-tokens y elegí **Create API token**.
2. Completá `JIRA_BASE_URL` (por ejemplo `https://flockit.atlassian.net`), `JIRA_EMAIL` y `JIRA_API_TOKEN`.
3. Las cards se crean a tu nombre, porque el token es tuyo, y llevan el label `sugerida-ia`.
4. Para asignar responsables vas a necesitar el `accountId` de cada persona. Lo ves en la URL de su perfil de Jira (`/jira/people/<accountId>`), o le podés pedir a Claude "buscame el accountId de X" con el conector de Atlassian.

### Slack (para leer los contratos)

1. En https://api.slack.com/apps elegí **Create New App**, después **From scratch** y el workspace de Flock.
2. En **OAuth & Permissions**, agregá estos Bot Token Scopes: `channels:read`, `groups:read`, `files:read`.
3. Hacé **Install to Workspace** (puede pedir la aprobación de un admin) y copiá el `xoxb-...` en `SLACK_BOT_TOKEN`.
4. En cada canal de proyecto, escribí `/invite @nombre-de-tu-app`.

---

## 3. Deploy en Vercel (paso a paso por CLI)

```bash
# 1. CLI y login (podés entrar con GitHub o con email)
npm i -g vercel
vercel login

# 2. Crear el proyecto en Vercel desde esta carpeta
vercel link            # "Set up and deploy?" Y → elegí tu cuenta → nombre: flock-tm-mcp

# 3. Variables de entorno (te pide el valor de cada una)
vercel env add TM_KEY production
vercel env add TEAM_KEY production
vercel env add JIRA_BASE_URL production
vercel env add JIRA_EMAIL production
vercel env add JIRA_API_TOKEN production
vercel env add SLACK_BOT_TOKEN production
```

### 4. Storage: Upstash Redis (gratis)

Este paso es en el dashboard: https://vercel.com, luego tu proyecto, la pestaña **Storage**, **Create Database**, **Upstash → Redis**, **Create** y por último **Connect Project**.

Eso crea solas las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`. Si querés usarlas también en local:

```bash
vercel env pull .env.local
```

### 5. Publicar

```bash
vercel --prod
# → https://flock-tm-mcp.vercel.app   (o el nombre que elegiste)
```

Para verificarlo, abrí la URL en el navegador. La home muestra si el storage, Jira y Slack están configurados.

> **¿Vercel te devuelve un 401 o una pantalla de login?** Andá a Settings, después Deployment Protection, y fijate que el dominio de *producción* no tenga activado "Vercel Authentication".

### 6. Re-deploy después de un cambio

```bash
vercel --prod
```

Si querés que publique solo con cada push, conectá el repo de GitHub en Settings → Git.

---

## 4. Conectarlo en Claude

**Vos:** en Claude, entrá a **Settings → Connectors → Add custom connector**.
- Nombre: `Flock TM`
- URL: `https://flock-tm-mcp.vercel.app/tm/mcp?key=TU_TM_KEY`

**El equipo:** hace lo mismo con
- Nombre: `Flock Equipo`
- URL: `https://flock-tm-mcp.vercel.app/team/mcp?key=TEAM_KEY`

Si Flock tiene plan Team o Enterprise, puede que un owner tenga que agregar el conector desde la configuración de la organización.

### Primer uso

```
Configurá el proyecto mega: nombre "MEGA (AAARBA)", Jira AM, canal Slack proy-aaarba-gestion,
equipo Paula (UX), Nacho (Dev), Juanchi (Dev), Francisco (Dev), Vero (QA) con sus accountId.
```
Después:
- `/chequeo-contrato mega`: busca el contrato en Slack, te muestra los términos y los guarda cuando confirmás.
- `/post-refinamiento mega <link de Fathom>`: propone las cards y las deja pendientes en el tablero.

---

## 5. Seguridad (para después del AI Day)

- La clave va en la URL. Con eso alcanza para un piloto interno, pero **cualquiera que tenga la URL del TM ve los montos**, así que no la compartas.
- Si una clave se filtra, cambiala con `vercel env rm TM_KEY production`, después `vercel env add ...` y `vercel --prod`.
- Para producción, el siguiente paso es OAuth con Microsoft Entra ID usando `withMcpAuth` de `mcp-handler`. Con eso cada persona entra con su cuenta de Flock y el rol sale del grupo de Entra.

---

## Estructura

```
app/tm/[transport]/route.ts     endpoint del TM
app/team/[transport]/route.ts   endpoint del equipo
lib/handler.ts                  arma el server por rol y valida la clave
lib/tools/team.ts               sugerencias, aprobar en Jira, higiene, velocidad, board_snapshot
lib/tools/tm.ts                 proyectos y contratos
lib/prompts.ts                  post-refinamiento, status-semanal, chequeo-contrato
lib/jira.ts / lib/slack.ts      clientes REST
lib/analysis.ts                 cálculos de higiene y velocidad
lib/workdays.ts                 días hábiles con feriados de Argentina (revisar la lista)
lib/store.ts                    Upstash Redis o memoria
```
