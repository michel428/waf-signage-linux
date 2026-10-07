#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  WAF Signage — mise à jour automatique de l'appli (Linux)
#  Lancé en root par le minuteur systemd waf-signage-update.timer
#  (chaque nuit vers 3 h 30 + 10 min après le démarrage du PC).
#  Journal : journalctl -u waf-signage-update
# ═══════════════════════════════════════════════════════════════
set -u
API="https://signage.waf-forme.fr/api/app-version.php?platform=linux"
CACHE=/var/cache/waf-signage
mkdir -p "$CACHE"

JSON=$(curl -fsSL --max-time 20 "$API") || { echo "Serveur injoignable ou aucune version publiée."; exit 0; }
LINE=$(printf '%s' "$JSON" | python3 -c 'import sys,json; d=(json.load(sys.stdin).get("data") or {}); print(d.get("version",""), d.get("url",""))' 2>/dev/null)
VER=${LINE%% *}
URL=${LINE#* }
if [ -z "$VER" ] || [ -z "$URL" ] || [ "$URL" = "$LINE" ]; then echo "Réponse inattendue : $JSON"; exit 0; fi

CUR=$(dpkg-query -W -f='${Version}' waf-signage 2>/dev/null)
if [ -n "$CUR" ] && dpkg --compare-versions "$CUR" ge "$VER"; then
  echo "WAF Signage à jour ($CUR)."
  exit 0
fi

echo "Mise à jour WAF Signage : $CUR → $VER"
curl -fsSL --max-time 600 -o "$CACHE/waf-signage.deb" "$URL" || { echo "Téléchargement échoué."; exit 1; }
for i in 1 2 3 4 5 6; do
  if DEBIAN_FRONTEND=noninteractive apt-get install -y "$CACHE/waf-signage.deb"; then
    echo "Version $VER installée — l'appli redémarre toute seule."
    exit 0
  fi
  echo "Gestionnaire de paquets occupé, nouvel essai dans 60 s…"; sleep 60
done
exit 1
