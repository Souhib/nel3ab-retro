#!/usr/bin/env bash
# Met en service ce que le dépôt décrit: les unités, la porte Caddy, les
# anciennes portes `.ts.net`, puis vérifie.
#
#   sudo bash deploy/mettre-en-service.sh
#
# Depuis le dossier de production (`/home/souhib/nel3ab-retro`), sur `main`.
#
# Ce qu'il coupe: le salon redémarre (une partie en cours garde son image, son
# son et sa manette, et perd les noms quelques secondes), et Caddy redémarre
# (moins d'une seconde: il n'a pas de rechargement, voir son unité). Aucune
# salle n'est arrêtée.
#
# Ce qu'il refuse: un Caddyfile que `caddy validate` rejette, avant d'avoir
# rien copié. L'ancien Caddyfile est gardé à côté, daté.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "à lancer avec sudo" >&2
    exit 2
fi
cd "$(dirname "$0")/.."
proprietaire=$(stat -c %U .)
jour=$(date -u +%Y%m%dT%H%M%SZ)

echo "1. Le Caddyfile du dépôt se valide"
(
    set -a
    # shellcheck disable=SC1091
    . "/home/$proprietaire/.config/nel3ab/cloudflare.env"
    set +a
    caddy validate --config deploy/Caddyfile >/dev/null
)

echo "2. Unités et Caddyfile installés"
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.avant-$jour"
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
install -m 644 deploy/nel3ab-control.service /etc/systemd/system/nel3ab-control.service
systemctl daemon-reload

echo "3. Salon, boîte noire et Caddy redémarrés"
systemctl restart nel3ab-control nel3ab-boite-noire nel3ab-caddy

echo "4. Les anciennes portes .ts.net renvoient vers nel3ab.app"
tailscale serve --https=8443 off >/dev/null 2>&1 || true
tailscale serve --https=8444 off >/dev/null 2>&1 || true
tailscale serve --bg --https=8443 http://127.0.0.1:8098 >/dev/null
tailscale serve --bg --https=8444 http://127.0.0.1:8097 >/dev/null

echo "5. Ce qui répond"
for essai in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS -o /dev/null http://127.0.0.1:8200/importer && break
    sleep 1
done
for chemin in / /importer /profil /api/imports/droits; do
    printf '   salon %-22s %s\n' "$chemin" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8200$chemin")"
done
printf '   ancienne porte 8443    %s\n' "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://127.0.0.1:8098/r/1/)"
printf '   ancienne porte 8444    %s\n' "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://127.0.0.1:8097/carnet-de-bord/)"

echo "6. Le dépôt et la machine disent la même chose"
sudo -u "$proprietaire" env PATH="/home/$proprietaire/.cargo/bin:$PATH" just deploy-check
