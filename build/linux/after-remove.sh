#!/bin/bash

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

# ── WAF : désinstallation complète (pas lors d'une mise à jour) ──
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    systemctl disable --now waf-signage-update.timer waf-signage-update.path 2>/dev/null || true
    rm -f /etc/systemd/system/waf-signage-update.service /etc/systemd/system/waf-signage-update.timer /etc/systemd/system/waf-signage-update.path /usr/local/sbin/waf-signage-update
    rm -rf /var/lib/waf-signage
    systemctl daemon-reload 2>/dev/null || true
fi
