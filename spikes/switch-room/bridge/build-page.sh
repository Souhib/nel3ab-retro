#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
../../../front/node_modules/.bin/tsc -p tsconfig.json
../../../front/node_modules/.bin/rolldown client.ts --format iife --minify --file client.js
python3 - <<'PY'
from pathlib import Path
script = Path('client.js').read_text()
Path('page.html').write_text(Path('page.template.html').read_text().replace('/* CLIENT_SCRIPT */', script))
PY
