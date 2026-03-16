#!/bin/bash
set -e
GD="/Users/alvarogallardo/andex-gateway"
PLIST="app.andex.gateway.plist"
DEST="$HOME/Library/LaunchAgents/$PLIST"

echo "Andex Gateway - Instalador macOS"

# Certs
if [ ! -f "$GD/certs/localhost+2.pem" ]; then
    command -v mkcert >/dev/null || { brew install mkcert && mkcert -install; }
    mkdir -p "$GD/certs" && cd "$GD/certs" && mkcert localhost 127.0.0.1 ::1
fi

cd "$GD" && npm install
mkdir -p "$GD/logs"
cp "$GD/$PLIST" "$DEST"
launchctl unload "$DEST" 2>/dev/null || true
launchctl load -w "$DEST"

echo "OK - Gateway instalado como servicio"
echo "  Logs:    tail -f $GD/logs/gateway.log"
echo "  Parar:   launchctl unload $DEST"
echo "  Quitar:  launchctl unload $DEST && rm $DEST"
