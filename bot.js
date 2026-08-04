const bedrock = require('bedrock-protocol');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dns = require('dns').promises;

// --- 1. RENDER HEALTH CHECK SERVER (For Uptime Robot) ---
const app = express();
const PORT_WEB = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.status(200).send('Pixi Bedrock Bot is online and ready!');
});

app.listen(PORT_WEB, () => {
    console.log(`[Web Server] Listening on port ${PORT_WEB} for Uptime Robot.`);
});

// --- 2. CONFIGURATION ---
const ATERNOS_SERVER_NAME = process.env.MC_HOST ? process.env.MC_HOST.replace('.aternos.me', '') : 'piximc';
const BOT_NAME = process.env.MC_USERNAME || 'pixi';
const STORAGE_FILE = path.join(__dirname, 'commands.json');
const DEFAULT_VERSION = '1.21.60'; 

let client = null;
let isConnecting = false;
let actionInterval = null;
let reconnectAttempts = 0;

// --- 3. BULLETPROOF VERSION ENGINE ---
function resolveBestSupportedVersion(serverVersionString) {
    try {
        let supportedVersions = [];
        if (bedrock.supportedVersions) {
            supportedVersions = bedrock.supportedVersions;
        } else {
            const options = require('bedrock-protocol/src/options') || {};
            supportedVersions = Object.keys(options.Versions || {});
        }
        
        if (!supportedVersions || supportedVersions.length === 0) return DEFAULT_VERSION;
        if (supportedVersions.includes(serverVersionString)) return serverVersionString;

        const majorMinor = serverVersionString.split('.').slice(0, 2).join('.');
        const matchingFamily = supportedVersions.filter(v => v.startsWith(majorMinor));
        if (matchingFamily.length > 0) return matchingFamily[matchingFamily.length - 1];

        return supportedVersions[supportedVersions.length - 1];
    } catch (err) {
        console.warn(`[Version Engine] Failed to parse versions. Defaulting to ${DEFAULT_VERSION}`);
        return DEFAULT_VERSION;
    }
}

// --- 4. ROBUST ATERNOS DNS RESOLUTION ---
async function resolveAternosServer(serverName) {
    const fullHost = `${serverName}.aternos.me`;
    const defaultPort = parseInt(process.env.MC_PORT) || 43180;

    try {
        const srvRecords = await dns.resolveSrv(`_minecraft._udp.${fullHost}`);
        if (srvRecords && srvRecords.length > 0) {
            return { host: srvRecords[0].name || fullHost, port: srvRecords[0].port };
        }
    } catch (e) {
        // SRV Failed, moving to standard IP lookup
    }

    try {
        const addresses = await dns.lookup(fullHost);
        return { host: addresses.address, port: defaultPort };
    } catch (err) {
        console.error(`[DNS Warning] Could not resolve ${fullHost}. Falling back to default settings.`);
        return { host: fullHost, port: defaultPort };
    }
}

// --- 5. DUCK SKIN GENERATOR ---
function generateWhiteDuckSkin() {
    const width = 64, height = 64;
    const buf = Buffer.alloc(width * height * 4, 255); 
    
    function fillRect(x1, y1, x2, y2, color) {
        for (let x = x1; x <= x2; x++) {
            for (let y = y1; y <= y2; y++) {
                if (x < 0 || x >= width || y < 0 || y >= height) continue;
                const idx = (y * width + x) * 4;
                buf[idx] = color[0]; buf[idx + 1] = color[1]; buf[idx + 2] = color[2]; buf[idx + 3] = color[3];
            }
        }
    }

    const YELLOW = [255, 180, 0, 255], ORANGE = [230, 100, 0, 255];
    const EYE = [20, 20, 20, 255], SHADOW = [220, 220, 220, 255];

    fillRect(9, 11, 9, 11, EYE); fillRect(14, 11, 14, 11, EYE);
    fillRect(9, 13, 14, 14, YELLOW);
    fillRect(0, 28, 15, 31, ORANGE); fillRect(16, 28, 31, 31, ORANGE);
    fillRect(40, 20, 43, 31, SHADOW); fillRect(48, 20, 51, 31, SHADOW);

    return { skinId: "ExactWhiteDuck", skinData: buf, skinImageWidth: width, skinImageHeight: height, capeData: Buffer.alloc(0) };
}

// --- 6. SAFE FILE STORAGE ---
function loadPermanentCommands() {
    try {
        if (fs.existsSync(STORAGE_FILE)) return new Map(Object.entries(JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'))));
    } catch (err) { console.error("[Storage Error] Corrupted commands.json. Starting fresh."); }
    return new Map();
}

function savePermanentCommands(permMap) {
    try { fs.writeFileSync(STORAGE_FILE, JSON.stringify(Object.fromEntries(permMap), null, 2), 'utf8'); } 
    catch (err) { console.error("[Storage Error] Failed to save.", err.message); }
}

// --- 7. MAIN CONNECTION LOOP ---
async function startBot() {
    if (isConnecting) return;
    isConnecting = true;
    stopAll();

    const target = await resolveAternosServer(ATERNOS_SERVER_NAME);
    console.log(`\n[Attempting Connection] Target: ${target.host}:${target.port} | Bot: ${BOT_NAME}`);

    try {
        const pingResult = await bedrock.ping({ host: target.host, port: target.port, timeout: 5000 });
        console.log(`[Ping] Server Version: ${pingResult.version}`);
        
        reconnectAttempts = 0; 
        connectClient(target.host, target.port, resolveBestSupportedVersion(pingResult.version));
    } catch (err) {
        console.error(`[Ping Failed] Server offline or unreachable.`);
        triggerBackoffReconnect();
    }
}

function connectClient(host, port, serverVersion) {
    try {
        client = bedrock.createClient({
            host: host, port: port, username: BOT_NAME, offline: true, skipPing: true,
            version: serverVersion, raknetBackend: 'jsp-raknet', connectTimeout: 30000,
            skinData: generateWhiteDuckSkin()
        });

        const permShortcuts = loadPermanentCommands();
        const tempShortcuts = new Map();
        const nearbyPlayers = new Map();
        let priorityTarget = 'pixelbrine';

        client.on('join', () => console.log(`🎉 [SUCCESS] Joined ${host}:${port}!`));

        client.on('spawn', () => {
            console.log(`[+] Spawned into the world!`);
            isConnecting = false;
            sendChat(`${BOT_NAME} online! Type '*${BOT_NAME} guide1' for help.`);
        });

        client.on('add_player', (p) => nearbyPlayers.set(p.username.toLowerCase(), { id: p.runtime_id }));
        client.on('remove_actor', (p) => {
            for (const [name, data] of nearbyPlayers.entries()) {
                if (data.id === p.entity_unique_id) nearbyPlayers.delete(name);
            }
        });

        client.on('text', (packet) => {
            if (packet.source_name === BOT_NAME) return;
            const rawMsg = (packet.message || '').trim();
            const sender = packet.source_name;

            if (tempShortcuts.has(rawMsg.toLowerCase())) {
                parseCommand(tempShortcuts.get(rawMsg.toLowerCase()), sender);
                return;
            }
            if (permShortcuts.has(rawMsg.toLowerCase())) {
                parseCommand(permShortcuts.get(rawMsg.toLowerCase()), sender);
                return;
            }
            parseCommand(rawMsg, sender);
        });

        function parseCommand(rawMsg, sender) {
            if (!rawMsg.startsWith('*')) return;
            const cleanMsg = rawMsg.toLowerCase();

            if (cleanMsg === `*${BOT_NAME.toLowerCase()} 0` || cleanMsg === '*all 0') {
                stopAll();
                sendChat('Stopped all actions.');
                return;
            }

            // Shortcut Management
            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} perm`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                const fullCmd = parts.slice(3).join(' ');
                if (sc && fullCmd) {
                    permShortcuts.set(sc, fullCmd);
                    savePermanentCommands(permShortcuts);
                    sendChat(`[PERM] Shortcut '${sc}' saved.`);
                }
                return;
            }

            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} temp`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                const fullCmd = parts.slice(3).join(' ');
                if (sc && fullCmd) {
                    tempShortcuts.set(sc, fullCmd);
                    sendChat(`[TEMP] Shortcut '${sc}' activated.`);
                }
                return;
            }

            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} del`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                let deleted = false;
                if (tempShortcuts.has(sc)) { tempShortcuts.delete(sc); deleted = true; }
                if (permShortcuts.has(sc)) { permShortcuts.delete(sc); savePermanentCommands(permShortcuts); deleted = true; }
                sendChat(deleted ? `Deleted shortcut '${sc}'.` : `Shortcut '${sc}' not found.`);
                return;
            }

            if (cleanMsg === `*${BOT_NAME.toLowerCase()} list`) {
                const pKeys = Array.from(permShortcuts.keys()).join(', ') || 'None';
                const tKeys = Array.from(tempShortcuts.keys()).join(', ') || 'None';
                sendChat(`Perm: [${pKeys}] | Temp: [${tKeys}]`);
                return;
            }

            // Guides
            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide1`) {
                sendChat(`[Guide 1/3] Actions: *${BOT_NAME} afk!11 | afk<x,y,z>!11 | kill<target>!11 | mine<dir>!11 | 0`);
                return;
            }
            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide2`) {
                sendChat(`[Guide 2/3] Items: *${BOT_NAME} dropitem!01 | dropinv!01 | equiparmor!01 | droparmor!01`);
                return;
            }
            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide3`) {
                sendChat(`[Guide 3/3] Shortcuts: *${BOT_NAME} perm <sc> <cmd> | temp <sc> <cmd> | del <sc> | list`);
                return;
            }

            // Core Command Parsing
            const cmdBody = rawMsg.substring(1);
            const targetBot = cmdBody.startsWith(BOT_NAME.toLowerCase()) ? BOT_NAME.toLowerCase() : (cmdBody.startsWith('all') ? 'all' : null);
            if (!targetBot) return;

            const payload = cmdBody.substring(targetBot.length);
            const flagIndex = payload.lastIndexOf('!');
            
            let actionTargetStr = payload;
            let careful = false;
            let state = true;

            if (flagIndex !== -1) {
                actionTargetStr = payload.substring(0, flagIndex);
                const flags = payload.substring(flagIndex + 1);
                careful = flags.charAt(0) === '1';
                state = flags.charAt(1) === '1';
            }

            if (!state) {
                stopAll();
                sendChat('Action disabled.');
                return;
            }

            let action = actionTargetStr;
            let targetParam = sender.toLowerCase();

            const knownActions = ['kill', 'mine', 'afk', 'dropitem', 'dropinv', 'droparmor', 'equiparmor'];
            for (const act of knownActions) {
                if (actionTargetStr.startsWith(act)) {
                    action = act;
                    const param = actionTargetStr.substring(act.length);
                    if (param) targetParam = param.toLowerCase();
                    break;
                }
            }

            executeAction(action, targetParam, careful);
        }

        function executeAction(action, target, careful) {
            stopAll();

            if (action === 'dropitem') {
                sendChat('Dropping held item.');
                dropSelectedSlot(0);
            } else if (action === 'dropinv') {
                sendChat('Dropping inventory.');
                for (let i = 0; i < 36; i++) dropSelectedSlot(i);
            } else if (action === 'droparmor') {
                sendChat('Stripping armor.');
                if (client) client.queue('mob_armor_equipment', { entity_runtime_id: 0, helmet: { id: 0 }, chestplate: { id: 0 }, leggings: { id: 0 }, boots: { id: 0 } });
            } else if (action === 'equiparmor') {
                sendChat('Equipping armor.');
                if (client) client.queue('mob_armor_equipment', { entity_runtime_id: 0, helmet: { id: 310 }, chestplate: { id: 311 }, leggings: { id: 312 }, boots: { id: 313 } });
            } else if (action === 'afk') {
                let afkCoords = null;
                if (target.includes(',')) {
                    const coords = target.split(',');
                    afkCoords = { x: parseFloat(coords[0]), y: parseFloat(coords[1]), z: parseFloat(coords[2]) };
                    sendChat(`Moving to AFK location: ${target}`);
                } else {
                    sendChat(`AFK active (Platform Safe: ${careful}).`);
                }

                actionInterval = setInterval(() => {
                    if (!client) return stopAll(); // Anti-crash check
                    const enemy = nearbyPlayers.get(priorityTarget);
                    if (enemy) { sendAttack(enemy.id); return; }

                    const yaw = (Math.random() * 360) - 180;
                    try {
                        client.queue('player_auth_input', {
                            pitch: 0, yaw: yaw, position: afkCoords || { x: 0, y: 0, z: 0 },
                            move_vector: { x: 0, z: 0 }, head_yaw: yaw,
                            input_data: { sneaking: Math.random() < 0.3, jump: false },
                            input_mode: 'touch', play_mode: 'normal', interaction_model: 'touch'
                        });
                    } catch (e) {}
                }, 2000);
            } else if (action === 'kill') {
                const pData = nearbyPlayers.get(target);
                if (pData) {
                    sendChat(`Attacking ${target}...`);
                    actionInterval = setInterval(() => {
                        if (!client) return stopAll(); // Anti-crash check
                        sendAttack(pData.id);
                    }, 600);
                } else {
                    sendChat(`Target '${target}' not found nearby.`);
                }
            } else if (action === 'mine') {
                sendChat(`Mining (Safe Mode: ${careful}).`);
                actionInterval = setInterval(() => {
                    if (!client) return stopAll(); // Anti-crash check
                    try {
                        client.queue('player_auth_input', {
                            pitch: 0, yaw: 0, position: { x: 0, y: 0, z: 0 },
                            move_vector: careful ? { x: 0, z: 0.05 } : { x: 0, z: 0.2 }, head_yaw: 0,
                            input_data: { sneaking: careful, sprinting: false },
                            input_mode: 'touch', play_mode: 'normal', interaction_model: 'touch'
                        });
                    } catch (e) {}
                }, 500);
            }
        }

        function dropSelectedSlot(slotIndex) {
            if (!client) return;
            try {
                client.queue('inventory_transaction', {
                    transaction: {
                        legacy: { legacy_request_id: 0 }, transaction_type: 'item_release', actions: [],
                        action_data: { action_type: 'drop', hotbar_slot: slotIndex, held_item: { id: 0 }, head_pos: { x: 0, y: 0, z: 0 } }
                    }
                });
            } catch (e) {}
        }

        function sendAttack(id) {
            if (!client) return;
            try {
                client.queue('inventory_transaction', {
                    transaction: {
                        legacy: { legacy_request_id: 0 }, transaction_type: 'item_use_on_entity', actions: [],
                        action_data: { entity_runtime_id: id, action_type: 'attack', hotbar_slot: 0, held_item: { id: 0 }, player_pos: { x: 0, y: 0, z: 0 }, click_pos: { x: 0, y: 0, z: 0 } }
                    }
                });
            } catch (e) {}
        }

        function sendChat(text) {
            if (!client) return;
            try {
                client.queue('text', { type: 'chat', needs_translation: false, source_name: BOT_NAME, xuid: '', platform_chat_id: '', filtered_message: '', message: text });
            } catch (e) { console.error("Failed to send chat message:", e.message); }
        }

        // Network Safety Events
        client.on('error', (err) => { console.error('[Client Error]:', err.message); });
        client.on('disconnect', (packet) => { console.log(`[Kicked]: ${packet.message}`); triggerBackoffReconnect(); });
        client.on('close', () => { console.log(`[Closed]: Connection terminated.`); triggerBackoffReconnect(); });
        client.on('end', () => { console.log(`[End]: Session ended.`); triggerBackoffReconnect(); });

    } catch (err) {
        console.error('[Init Error]:', err.message);
        triggerBackoffReconnect();
    }
}

function stopAll() {
    if (actionInterval) { clearInterval(actionInterval); actionInterval = null; }
}

function triggerBackoffReconnect() {
    stopAll();
    isConnecting = false;
    if (client) { try { client.close(); } catch (e) {} client = null; }
    
    // Exponential backoff to prevent Aternos IP-bans (Caps at ~1 minute)
    reconnectAttempts++;
    const delayMs = Math.min(15000 * Math.pow(1.5, reconnectAttempts - 1), 60000); 
    
    console.log(`Reconnecting in ${Math.round(delayMs / 1000)} seconds (Attempt ${reconnectAttempts})...`);
    setTimeout(startBot, delayMs);
}

// Global Crash Suppressors (Last Resort)
process.on('uncaughtException', (err) => { console.error('[Fatal Suppressed]:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('[Promise Suppressed]:', reason); });

startBot();
