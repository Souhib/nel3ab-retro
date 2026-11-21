#!/usr/bin/env bash
# Les anciennes adresses `.ts.net` renvoient-elles vers nel3ab.app, chemin
# compris, quand on passe par la vraie porte de tailscaled ? Rend 0 si oui.
#
# Par le nom du tailnet et pas par 127.0.0.1: tailscaled relaie avec le nom
# d'origine, et le 21 novembre 2026 les sites Caddy ne répondaient qu'à
# 127.0.0.1. L'essai direct passait, la vraie porte rendait une page vide.
set -uo pipefail
nom=$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))') || {
    echo "  nom du tailnet illisible"
    exit 1
}
faux=0
for essai in "8443/r/1/ https://nel3ab.app/r/1/" "8444/carnet-de-bord/ https://nel3ab.app/docs/carnet-de-bord/"; do
    chemin=${essai%% *}
    attendu=${essai#* }
    obtenu=$(curl -s -o /dev/null --max-time 15 -w '%{http_code} %{redirect_url}' "https://$nom:$chemin")
    if [ "$obtenu" = "302 $attendu" ]; then
        echo "   ok   https://$nom:$chemin -> $attendu"
    else
        echo "  la porte https://$nom:$chemin rend « $obtenu » au lieu de « 302 $attendu »"
        faux=1
    fi
done
exit "$faux"
