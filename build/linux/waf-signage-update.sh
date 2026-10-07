#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  WAF Signage — mise à jour automatique de l'appli (Linux)
#  Lancé en root par le minuteur systemd waf-signage-update.timer
#  (chaque nuit vers 3 h 30 + 10 min après le démarrage du PC).
#  Journal : journalctl -u waf-signage-update
# ═══════════════════════════════════════════════════════════════
set -u
STATUS=/var/lib/waf-signage/status
mkdir -p /var/lib/waf-signage && chmod 1777 /var/lib/waf-signage
# Message lisible par l'appli (menu → Rechercher une mise à jour)
say() { echo "$1"; printf '%s|%s\n' "$(date +%s)" "$1" > "$STATUS"; chmod 644 "$STATUS" 2>/dev/null; }
API="https://signage.waf-forme.fr/api/app-version.php?platform=linux"
CACHE=/var/cache/waf-signage
mkdir -p "$CACHE"

say "check|Recherche d'une mise à jour…"
JSON=$(curl -fsSL --max-time 20 "$API") || { say "none|Serveur injoignable ou aucune version publiée."; exit 0; }
LINE=$(printf '%s' "$JSON" | python3 -c 'import sys,json; d=(json.load(sys.stdin).get("data") or {}); print(d.get("version",""), d.get("url",""))' 2>/dev/null)
VER=${LINE%% *}
URL=${LINE#* }
if [ -z "$VER" ] || [ -z "$URL" ] || [ "$URL" = "$LINE" ]; then say "none|Réponse inattendue du serveur."; exit 0; fi

CUR=$(dpkg-query -W -f='${Version}' waf-signage 2>/dev/null)
if [ -n "$CUR" ] && dpkg --compare-versions "$CUR" ge "$VER"; then
  say "uptodate|$CUR"
  exit 0
fi

say "downloading|$VER"
curl -fsSL --max-time 600 -o "$CACHE/waf-signage.deb" "$URL" || { say "error|Téléchargement échoué."; exit 1; }
say "installing|$VER"
for i in 1 2 3 4 5 6; do
  if DEBIAN_FRONTEND=noninteractive apt-get install -y "$CACHE/waf-signage.deb"; then
    say "installed|$VER"
    exit 0
  fi
  say "installing|$VER (gestionnaire de paquets occupé, nouvel essai…)"; sleep 60
done
say "error|Installation impossible pour l'instant (réessaie plus tard)."
exit 1
