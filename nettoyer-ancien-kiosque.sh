#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  WAF Signage — Supprime l'ancien kiosque Linux (Chromium + services)
#  avant d'installer la nouvelle appli WAF Signage.
#
#  À lancer UNE fois, avec l'utilisateur qui affiche les écrans (pas root) :
#      bash nettoyer-ancien-kiosque.sh
#  Le mot de passe sera demandé pour la partie système (sudo).
# ═══════════════════════════════════════════════════════════════
set -u
if [ "$(id -u)" = "0" ]; then
  echo "Lance ce script avec l'utilisateur des écrans, pas en root (sans sudo devant)."
  exit 1
fi
ok(){ echo "  ✓ $1"; }

echo "=== Nettoyage de l'ancien kiosque WAF ==="

echo "[1/5] Arrêt des services utilisateur (waf-screen1 / waf-screen2)…"
for s in waf-screen1 waf-screen2; do
  systemctl --user stop "$s" 2>/dev/null; systemctl --user disable "$s" 2>/dev/null
  rm -f "$HOME/.config/systemd/user/$s.service"
done
systemctl --user daemon-reload 2>/dev/null
ok "services utilisateur supprimés"

echo "[2/5] Arrêt des services système (waf-kiosk, unclutter)…"
for s in waf-kiosk unclutter; do
  sudo systemctl stop "$s" 2>/dev/null; sudo systemctl disable "$s" 2>/dev/null
  sudo rm -f "/etc/systemd/system/$s.service"
done
for s in waf-screen1 waf-screen2; do sudo rm -f "/etc/systemd/user/$s.service"; done
sudo systemctl daemon-reload
sudo rm -rf /opt/waf-signage
ok "services système et /opt/waf-signage supprimés"

echo "[3/5] Suppression du watchdog (cron)…"
if crontab -l 2>/dev/null | grep -q "watchdog.sh"; then
  crontab -l 2>/dev/null | grep -v "watchdog.sh" | crontab -
fi
sudo rm -f /var/log/waf-watchdog.log
ok "watchdog retiré"

echo "[4/5] Suppression des fichiers de l'ancien kiosque…"
rm -f  "$HOME/.config/autostart/waf-signage-kiosk.desktop" "$HOME/.config/autostart/waf-signage-kiosk.desktop.disabled"
rm -rf "$HOME/.config/waf-signage" "$HOME/.config/waf-kiosk-profiles" "$HOME/waf-kiosk"
ok "scripts, profils Chromium et lancement automatique supprimés"

echo "[5/5] Fermeture des fenêtres Chromium du kiosque…"
pkill -f "waf-kiosk-profiles" 2>/dev/null
pkill -f "signage.waf-forme.fr/player" 2>/dev/null
ok "fenêtres fermées"

echo ""
echo "=== Terminé ✓ ==="
echo "Tu peux maintenant installer la nouvelle appli :"
echo "    sudo apt install ./waf-signage.deb"
echo "puis la lancer une fois depuis le menu (« WAF Signage »)."
