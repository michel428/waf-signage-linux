# WAF Signage — appli Linux

Même appli que sur les boîtiers Android, pour le PC Linux des écrans :
**une fenêtre plein écran par écran branché** (Écran 1 = le plus à gauche, Écran 2…),
chacune avec sa propre configuration.

## Créer l'appli avec GitHub
1. Nouveau dépôt (ex. `waf-signage-linux`).
2. **Add file → Upload files** : glisse le contenu de ce dossier, puis Commit.
   ⚠️ Le dossier `.github` est souvent caché : sinon *Actions → set up a workflow yourself*,
   nom `build-linux.yml`, colle le contenu de `.github/workflows/build-linux.yml`.
3. **Actions** : compilation ≈ 5 min → **Releases** : `waf-signage.deb` (+ `waf-signage.AppImage`).

## Installer sur le PC (Linux Mint)
```
sudo apt install ./waf-signage.deb
```
Puis lancer **WAF Signage** depuis le menu (une seule fois) : chaque écran affiche
« Configurer cet écran » → **Nouvel écran** (code à saisir dans l'admin) ou **Écran existant**.

L'appli s'ajoute toute seule au démarrage de session. Pour qu'elle revienne après une
coupure de courant : **Menu → Fenêtre de connexion → Utilisateurs → Connexion automatique**.

Si l'ancien kiosque (Chromium + `waf-kiosk.service`) est installé, le désactiver :
```
sudo systemctl disable --now waf-kiosk waf-screen1 waf-screen2 2>/dev/null
```

## Mises à jour automatiques
- Dans l'admin signage : **Réglages → Applis des écrans** → dépôt GitHub (ex. `ton-compte/waf-signage-linux`, dépôt **public**).
- Le PC vérifie chaque nuit vers 3 h 30 (et 10 min après chaque démarrage), installe la nouvelle version
  tout seul, et l'appli redémarre d'elle-même. Journal : `journalctl -u waf-signage-update`.
- Forcer une vérification : menu de l'écran (**F1**) → **Rechercher une mise à jour** (installation immédiate),
  ou `sudo systemctl start waf-signage-update`.

## Veille
Quand le club est fermé (Réglages → Horaires d'ouverture → mode veille), les écrans passent au noir
et l'appli **coupe le signal vidéo** : les moniteurs se mettent en économie d'énergie, puis se rallument
tout seuls à l'ouverture.

## Raccourcis
- **F1** ou **Ctrl+M** : menu de l'écran (changer d'écran, recharger…)
- **5 clics** dans le coin haut-gauche d'un écran : menu
- **Ctrl+Alt+R** : tout recharger · **Ctrl+Alt+Q** : quitter

Configuration enregistrée dans `~/.config/WAF Signage/config.json`.
