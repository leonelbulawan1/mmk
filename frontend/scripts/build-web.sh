#!/usr/bin/env bash
# Build the self-contained browser edition of Alaala into frontend/dist-web/.
#
# The output is a static site: React UI + the real Python backend (Pyodide) +
# the real access rules (SWI-Prolog WebAssembly). It needs no server, so it can
# be hosted anywhere static (Firebase Hosting, GitHub Pages, a claude.ai artifact).
#
# Usage:  cd frontend && bash scripts/build-web.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$HERE/../backend"
CACHE="${ALAALA_WEB_CACHE:-$HERE/.web-cache}"
OUT="$HERE/dist-web"
PYODIDE_VERSION="0.28.3"
SWIPL_WASM_VERSION="8.3.1"
PYODIDE_PACKAGES="pydantic pydantic-core sqlalchemy sqlite3 hashlib libopenssl ssl anyio sniffio idna typing-extensions annotated-types tzdata"
PURE_WHEELS="fastapi==0.115.12 starlette==0.46.2 PyJWT==2.10.1 email-validator==2.2.0 dnspython==2.7.0"

mkdir -p "$CACHE"

# 1. Pyodide runtime (only the files and packages Alaala uses)
if [ ! -f "$CACHE/pyodide/pyodide.mjs" ]; then
  echo "Downloading Pyodide $PYODIDE_VERSION…"
  curl -fL -o "$CACHE/pyodide.tar.bz2" \
    "https://github.com/pyodide/pyodide/releases/download/$PYODIDE_VERSION/pyodide-$PYODIDE_VERSION.tar.bz2"
  tar -xjf "$CACHE/pyodide.tar.bz2" -C "$CACHE" pyodide/pyodide-lock.json
  FILES=$(python3 - "$CACHE/pyodide/pyodide-lock.json" $PYODIDE_PACKAGES <<'EOF'
import json, sys
lock = json.load(open(sys.argv[1]))["packages"]
print(" ".join("pyodide/" + lock[n]["file_name"] for n in sys.argv[2:]))
EOF
)
  tar -xjf "$CACHE/pyodide.tar.bz2" -C "$CACHE" $FILES pyodide/pyodide.mjs pyodide/pyodide.asm.js \
    pyodide/pyodide.asm.wasm pyodide/python_stdlib.zip
  rm -f "$CACHE/pyodide.tar.bz2"
fi

# 2. Pure-Python wheels not shipped with Pyodide
if [ ! -d "$CACHE/wheels" ]; then
  pip download --no-deps --only-binary=:all: -d "$CACHE/wheels" $PURE_WHEELS
fi

# 3. SWI-Prolog WebAssembly bundle
if [ ! -f "$CACHE/swipl-bundle.js" ]; then
  (cd "$CACHE" && npm pack "swipl-wasm@$SWIPL_WASM_VERSION" >/dev/null && tar -xzf swipl-wasm-*.tgz \
    && cp package/dist/swipl/swipl-bundle.js . && rm -rf package swipl-wasm-*.tgz)
fi

# 4. React app in browser-runtime mode
(cd "$HERE" && VITE_WEB_RUNTIME=1 npx vite build --base ./ --outDir "$OUT" --emptyOutDir)

# 5. Assemble runtime/
R="$OUT/runtime"
mkdir -p "$R/wheels"
cp -r "$CACHE/pyodide" "$R/"
cp "$CACHE"/wheels/*.whl "$R/wheels/"
cp "$CACHE/swipl-bundle.js" "$R/"
cp "$BACKEND/app/prolog/access_rules.pl" "$R/"
(cd "$BACKEND" && rm -f "$R/backend.zip" && zip -qr "$R/backend.zip" app -x "*/__pycache__/*" "*.db")
python3 - "$R" <<'EOF'
import json, os, sys
r = sys.argv[1]
json.dump({"wheels": sorted(os.listdir(os.path.join(r, "wheels")))}, open(os.path.join(r, "manifest.json"), "w"))
EOF
# Static hosts such as claude.ai artifacts only serve some extensions, so archives get a ".wasm"
# suffix (bytes unchanged) and the rules file a ".txt" suffix; webRuntime.js maps the names back.
find "$R" -type f \( -name "*.whl" -o -name "*.zip" \) -exec mv {} {}.wasm \;
mv "$R/access_rules.pl" "$R/access_rules.pl.txt"
echo "Browser edition built in $OUT ($(du -sh "$OUT" | cut -f1))"
