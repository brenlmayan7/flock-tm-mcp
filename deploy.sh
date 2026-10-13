#!/bin/bash
# Deploy del Flock TM MCP en Vercel. Uso: bash deploy.sh
set -e
cd "$(dirname "$0")"
V="npx -y vercel"

echo ""
echo "== 1/4  Llaves de acceso (se generan solas) =="
TM_KEY=$(openssl rand -hex 24)
TEAM_KEY=$(openssl rand -hex 24)

echo ""
echo "== 2/4  Datos de Jira =="
read -p "URL de Jira (ej: https://flockit.atlassian.net): " JIRA_BASE_URL
read -p "Tu email de Jira: " JIRA_EMAIL
read -s -p "Tu API token de Jira (no se ve al pegar, es normal): " JIRA_API_TOKEN; echo ""

echo ""
echo "== Cargando variables en Vercel... =="
setenv () {
  $V env rm "$1" production -y >/dev/null 2>&1 || true
  printf "%s" "$2" | $V env add "$1" production >/dev/null
  echo "  ✓ $1"
}
setenv TM_KEY "$TM_KEY"
setenv TEAM_KEY "$TEAM_KEY"
setenv JIRA_BASE_URL "${JIRA_BASE_URL%/}"
setenv JIRA_EMAIL "$JIRA_EMAIL"
setenv JIRA_API_TOKEN "$JIRA_API_TOKEN"

echo ""
echo "== 3/4  Memoria (Upstash) - esto se hace en el navegador =="
echo "  1. Abrí https://vercel.com → proyecto flock-tm-mcp → pestaña Storage"
echo "  2. Create Database → Upstash → Redis → plan Free → Create"
echo "  3. Connect Project → flock-tm-mcp"
read -p "  Cuando termines, apretá Enter para seguir... "

echo ""
echo "== 4/4  Publicando (tarda 1-2 minutos) =="
URL=$($V --prod --yes 2>/dev/null | tail -1)
BASE=$(echo "$URL" | sed -E 's#(https://[^/]+).*#\1#')
# preferir el dominio corto del proyecto
BASE_SHORT="https://flock-tm-mcp.vercel.app"
curl -s -o /dev/null -w "%{http_code}" "$BASE_SHORT" | grep -q 200 && BASE="$BASE_SHORT"

cat > CONECTORES-PRIVADO.txt <<TXT
NO COMPARTIR ESTE ARCHIVO.

Conector para vos (Claude → Settings → Connectors → Add custom connector):
  Nombre: Flock TM
  URL:    $BASE/tm/mcp?key=$TM_KEY

Conector para el equipo:
  Nombre: Flock Equipo
  URL:    $BASE/team/mcp?key=$TEAM_KEY
TXT

echo ""
echo "✅ ¡Listo! Publicado en: $BASE"
echo "   Abrilo en el navegador para ver si Storage y Jira están OK."
echo "   Las URLs de los conectores quedaron en el archivo CONECTORES-PRIVADO.txt"
open CONECTORES-PRIVADO.txt 2>/dev/null || true
