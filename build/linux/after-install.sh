#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# ── WAF : mise à jour automatique chaque nuit (minuteur systemd, root) ──
install -m 0755 '/opt/${sanitizedProductName}/resources/updater/waf-signage-update.sh' /usr/local/sbin/waf-signage-update || true
if [ -d /run/systemd/system ]; then
cat > /etc/systemd/system/waf-signage-update.service <<'UNIT'
[Unit]
Description=Mise à jour automatique WAF Signage
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/waf-signage-update
UNIT
cat > /etc/systemd/system/waf-signage-update.timer <<'UNIT'
[Unit]
Description=Vérification nocturne des mises à jour WAF Signage

[Timer]
OnBootSec=10min
OnCalendar=*-*-* 03:30
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload || true
systemctl enable --now waf-signage-update.timer || true
fi
