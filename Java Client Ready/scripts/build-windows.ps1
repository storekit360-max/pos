$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
mvn clean package
jpackage --type exe --name POS360 --app-version 1.0.0 --input target --main-jar pos360-java-client-1.0.0.jar --main-class lk.zenstack360.pos.Pos360Application --dest installers/windows --win-menu --win-shortcut --win-dir-chooser
