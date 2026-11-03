'use strict';

// Electron interprets ELECTRON_RUN_AS_NODE as a request to launch Node only.
// Some hosts export it globally, so clear it before starting the Electron app.
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const electronPath = require('electron');
// Resolve the app from this project, even if npm is invoked from another cwd.
const child = spawn(electronPath, [__dirname], { cwd: __dirname, stdio: 'inherit', env: process.env });

child.on('error', error => {
  console.error('Could not launch Electron:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
