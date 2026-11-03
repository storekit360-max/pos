#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Please install Node.js LTS from https://nodejs.org then run this again."
  read -p "Press Enter..."; exit 1
fi
[ -d node_modules ] || npm install
unset ELECTRON_RUN_AS_NODE
npm start
