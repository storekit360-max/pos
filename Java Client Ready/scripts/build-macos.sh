#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mvn clean package
jpackage --type dmg --name POS360 --app-version 1.0.0 --input target --main-jar pos360-java-client-1.0.0.jar --main-class lk.zenstack360.pos.Pos360Application --dest installers/macos
