import { spawn } from 'node:child_process';
import server from './serve.mjs';
const url = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;
function open() { spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).unref(); }
server.once('listening', open);
server.once('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try { const response=await fetch(url); const html=await response.text(); if(html.includes('战斗训练')){open();process.exit(0);} } catch {}
  }
  console.error(`Could not start trainer: ${error.message}`); process.exitCode=1;
});
