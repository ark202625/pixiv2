/**
 * patch.js — runs automatically after `npm install` (postinstall hook)
 *
 * bedrock-protocol hard-codes 'raknet-native' (a native C++ addon) in
 * createClient.js at module-load time. The native addon requires cmake to
 * compile, which may not be available in all environments.
 *
 * This script rewrites that one line to use 'jsp-raknet' (pure JS) instead,
 * which works everywhere without any native compilation.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules/bedrock-protocol/src/createClient.js');

if (!fs.existsSync(filePath)) {
  console.log('[patch] bedrock-protocol not found — skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

const needle  = "require('./rak')('raknet-native')";
const replacement = "require('./rak')('jsp-raknet')";

if (content.includes(needle)) {
  content = content.replace(needle, replacement);
  fs.writeFileSync(filePath, content);
  console.log('[patch] ✓ bedrock-protocol patched → using jsp-raknet (pure JS backend)');
} else if (content.includes(replacement)) {
  console.log('[patch] Already patched — nothing to do');
} else {
  console.log('[patch] Unexpected createClient.js format — manual check needed');
}
