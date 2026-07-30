const bedrock = require('bedrock-protocol');
const fs = require('fs');
const path = require('path');
const express = require('express');

// --- 1. RENDER HEALTH CHECK SERVER ---
const app = express();
const PORT_WEB = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.status(200).send('Pixi Bedrock Bot is running successfully!');
});

app.listen(PORT_WEB, () => {
    console.log(`[Web Server] Listening on port ${PORT_WEB} for health checks.`);
});

// --- 2. CONFIGURATION & FAILSAFES ---
const HOST = process.env.MC_HOST || 'piximc.aternos.me';
const PORT_MC = parseInt(process.env.MC_PORT) || 43180;
const BOT_NAME = process.env.MC_USERNAME || 'pixi'; 
const STORAGE_FILE = path.join(__dirname, 'commands.json');

let client = null;
let isConnecting = false;
let actionInterval = null;

// --- 3. DUCK SKIN GENERATOR ---
function generateWhiteDuckSkin() {
    const width = 64;
    const height = 64;
    const buf = Buffer.alloc(width * height * 4);

    const WHITE  = [255, 255, 255, 255];
    const YELLOW = [255, 180, 0, 255];
    const ORANGE = [230, 100, 0, 255];
    const EYE    = [20, 20, 20, 255];
    const SHADOW = [220, 220, 220, 255];

    for (let i = 0; i < buf.length; i += 4) {
        buf[i] = WHITE[0]; buf[i + 1] = WHITE[1]; buf[i + 2] = WHITE[2]; buf[i + 3] = WHITE[3];
    }

    function drawPixel(x, y, color) {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = (y * width + x) * 4;
        buf[idx] = color[0]; buf[idx + 1] = color[1]; buf[idx + 2] = color[2]; buf[idx + 3] = color[3];
    }

    function fillRect(x1, y1, x2, y2, color) {
        for (let x = x1; x <= x2; x++) {
            for (let y = y1; y <= y2; y++) drawPixel(x, y, color);
        }
    }

    drawPixel(9, 11, EYE); drawPixel(14, 11, EYE);
    fillRect(9, 13, 14, 14, YELLOW);
    fillRect(0, 28, 15, 31, ORANGE); fillRect(16, 28, 31, 31, ORANGE);
    fillRect(40, 20, 43, 31, SHADOW); fillRect(48, 20, 51, 31, SHADOW);

    return {
        skinId: "ExactWhiteDuck",
        skinData: buf,
        skinImageWidth: width,
        skinImageHeight: height,
        capeData: Buffer.alloc(0)
    };
}

// --- 4. SAFE FILE STORAGE ---
function loadPermanentCommands() {
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const data = fs.readFileSync(STORAGE_FILE, 'utf8');
            return new Map(Object.entries(JSON.parse(data)));
        }
    } catch (err) {
        console.error("[Storage] Error reading commands.json:", err.message);
    }
    return new Map();
}

function savePermanentCommands(permMap) {
    try {
        const obj = Object.fromEntries(permMap);
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
        console.error("[Storage] Error saving commands.json:", err.message);
    }
}

// --- 5. MAIN CONNECTION LOOP ---
function startBot() {
    if (isConnecting) return;
    isConnecting = true;
    stopAll();

    console.log(`\n--------------------------------------------------`);
    console.log(`[Attempting Connection] Target: ${HOST}:${PORT_MC}`);
    console.log(`[Bot Name]: ${BOT_NAME}`);
    console.log(`--------------------------------------------------\n`);

    // Dynamic Server Probe
    bedrock.ping({ host: HOST, port: PORT_MC })
        .then((pingResult) => {
            console.log(`[Ping Success] Server MOTD: ${pingResult.motd}`);
            console.log(`[Ping Success] Server Protocol Version: ${pingResult.version}`);

            // Pass the EXACT version returned by the ping to resolve version mismatches automatically
            connectClient(pingResult.version);
        })
        .catch((err) => {
            console.error(`[Ping Failed] Could not ping ${HOST}:${PORT_MC}.`);
            console.error(`Reason: ${err.message}`);
            console.error(`Ensure your Aternos server is ONLINE (Green Status).`);
            scheduleReconnect(15000);
        });
}

function connectClient(serverVersion) {
    try {
        client = bedrock.createClient({
            host: HOST,
            port: PORT_MC,
            username: BOT_NAME,
            offline: true,
            skipPing: true,               // Prevents double-pinging or fallback overrides
            version: serverVersion,        // Auto-sets to whatever version the server requested
            raknetBackend: 'jsp-raknet',   // Pure JS backend for Render compatibility
            connectTimeout: 30000,
            skinData: generateWhiteDuckSkin()
        });

        // Event Handlers
        client.on('connect', () => {
            console.log("[RakNet] Handshake established.");
        });

        client.on('join', () => {
            console.log(`🎉 [SUCCESS] ${BOT_NAME} connected to server!`);
        });

        const permShortcuts = loadPermanentCommands();
        const tempShortcuts = new Map();
        const nearbyPlayers = new Map();
        const nearbyMobs = new Map();
        let priorityTarget = 'pixelbrine';
        let isSneaking = false;

        client.on('spawn', () => {
            console.log(`[+] ${BOT_NAME} spawned into the world!`);
            isConnecting = false;
            sendChat(client, `${BOT_NAME} online! Type '*${BOT_NAME} guide1' for help.`);
        });

        // Entity Tracking
        client.on('add_player', (p) => nearbyPlayers.set(p.username.toLowerCase(), { id: p.runtime_id, pos: p.position }));
        client.on('add_actor', (m) => nearbyMobs.set(m.runtime_id, { type: m.type, pos: m.position }));
        client.on('remove_actor', (p) => {
            for (const [name, data] of nearbyPlayers.entries()) {
                if (data.id === p.entity_unique_id) nearbyPlayers.delete(name);
            }
            nearbyMobs.delete(p.entity_unique_id);
        });

        // Chat & Commands
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
                sendChat(client, 'Stopped all actions.');
                return;
            }

            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} perm`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                const fullCmd = parts.slice(3).join(' ');
                if (sc && fullCmd) {
                    permShortcuts.set(sc, fullCmd);
                    savePermanentCommands(permShortcuts);
                    sendChat(client, `[PERM] Shortcut '${sc}' saved to disk!`);
                }
                return;
            }

            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} temp`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                const fullCmd = parts.slice(3).join(' ');
                if (sc && fullCmd) {
                    tempShortcuts.set(sc, fullCmd);
                    sendChat(client, `[TEMP] Shortcut '${sc}' active until restart.`);
                }
                return;
            }

            if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} del`)) {
                const parts = rawMsg.split(' ');
                const sc = parts[2] ? parts[2].toLowerCase() : '';
                let deleted = false;
                if (tempShortcuts.has(sc)) { tempShortcuts.delete(sc); deleted = true; }
                if (permShortcuts.has(sc)) { permShortcuts.delete(sc); savePermanentCommands(permShortcuts); deleted = true; }
                sendChat(client, deleted ? `Deleted shortcut '${sc}'.` : `Shortcut '${sc}' not found.`);
                return;
            }

            if (cleanMsg === `*${BOT_NAME.toLowerCase()} list`) {
                const pKeys = Array.from(permShortcuts.keys()).join(', ') || 'None';
                const tKeys = Array.from(tempShortcuts.keys()).join(', ') || 'None';
                sendChat(client, `Perm: [${pKeys}] | Temp: [${tKeys}]`);
                return;
            }

            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide1`) {
                sendChat(client, `[Guide 1/3] Actions: *${BOT_NAME} afk!11 | afk<x,y,z>!11 | kill<target>!11 | mine<dir>!11 | 0 (Stop)`);
                return;
            }
            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide2`) {
                sendChat(client, `[Guide 2/3] Items: *${BOT_NAME} dropitem!01 | dropinv!01 | equiparmor!01 | droparmor!01`);
                return;
            }
            if (cleanMsg === `*${BOT_NAME.toLowerCase()} guide3`) {
                sendChat(client, `[Guide 3/3] Shortcuts: *${BOT_NAME} perm <sc> <cmd> | temp <sc> <cmd> | del <sc> | list`);
                return;
            }

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
                sendChat(client, 'Action disabled.');
                return;
            }

            let action = actionTargetStr;
            let targetParam = sender.toLowerCase();

            const knownActions = ['kill', 'mobkill', 'mine', 'come', 'guard', 'roam', 'afk', 'dropitem', 'dropinv', 'droparmor', 'equiparmor'];
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
                sendChat(client, 'Dropping held item.');
                dropSelectedSlot(0);
            } else if (action === 'dropinv') {
                sendChat(client, 'Dropping inventory.');
                for (let i = 0; i < 36; i++) dropSelectedSlot(i);
            } else if (action === 'droparmor') {
                sendChat(client, 'Stripping armor.');
                client.queue('mob_armor_equipment', {
                    entity_runtime_id: 0,
                    helmet: { id: 0 }, chestplate: { id: 0 }, leggings: { id: 0 }, boots: { id: 0 }
                });
            } else if (action === 'equiparmor') {
                sendChat(client, 'Equipping armor.');
                client.queue('mob_armor_equipment', {
                    entity_runtime_id: 0,
                    helmet: { id: 310 }, chestplate: { id: 311 }, leggings: { id: 312 }, boots: { id: 313 }
                });
            } else if (action === 'afk') {
                let afkCoords = null;
                if (target.includes(',')) {
                    const coords = target.split(',');
                    afkCoords = { x: parseFloat(coords[0]), y: parseFloat(coords[1]), z: parseFloat(coords[2]) };
                    sendChat(client, `Moving to AFK location: ${target}`);
                } else {
                    sendChat(client, `AFK active (Platform Safe: ${careful}).`);
                }

                actionInterval = setInterval(() => {
                    const enemy = nearbyPlayers.get(priorityTarget);
                    if (enemy) { sendAttack(enemy.id); return; }

                    const yaw = (Math.random() * 360) - 180;
                    client.queue('player_auth_input', {
                        pitch: 0, yaw: yaw,
                        position: afkCoords || { x: 0, y: 0, z: 0 },
                        move_vector: { x: 0, z: 0 },
                        head_yaw: yaw,
                        input_data: { sneaking: Math.random() < 0.3, jump: false },
                        input_mode: 'touch', play_mode: 'normal', interaction_model: 'touch'
                    });
                }, 2000);
            } else if (action === 'kill') {
                const pData = nearbyPlayers.get(target);
                if (pData) {
                    sendChat(client, `Attacking ${target}...`);
                    actionInterval = setInterval(() => {
                        sendAttack(pData.id);
                        if (careful) setSneak(true);
                    }, 600);
                } else {
                    sendChat(client, `Target '${target}' not found nearby.`);
                }
            } else if (action === 'mine') {
                sendChat(client, `Mining (Safe Mode: ${careful}).`);
                actionInterval = setInterval(() => {
                    client.queue('player_auth_input', {
                        pitch: 0, yaw: 0,
                        position: { x: 0, y: 0, z: 0 },
                        move_vector: careful ? { x: 0, z: 0.05 } : { x: 0, z: 0.2 },
                        head_yaw: 0,
                        input_data: { sneaking: careful, sprinting: false },
                        input_mode: 'touch', play_mode: 'normal', interaction_model: 'touch'
                    });
                }, 500);
            }
        }

        function dropSelectedSlot(slotIndex) {
            client.queue('inventory_transaction', {
                transaction: {
                    legacy: { legacy_request_id: 0 },
                    transaction_type: 'item_release',
                    actions: [],
                    action_data: {
                        action_type: 'drop', hotbar_slot: slotIndex,
                        held_item: { id: 0 }, head_pos: { x: 0, y: 0, z: 0 }
                    }
                }
            });
        }

        function sendAttack(id) {
            client.queue('inventory_transaction', {
                transaction: {
                    legacy: { legacy_request_id: 0 },
                    transaction_type: 'item_use_on_entity',
                    actions: [],
                    action_data: {
                        entity_runtime_id: id, action_type: 'attack',
                        hotbar_slot: 0, held_item: { id: 0 },
                        player_pos: { x: 0, y: 0, z: 0 }, click_pos: { x: 0, y: 0, z: 0 }
                    }
                }
            });
        }

        function setSneak(enable) {
            isSneaking = enable;
            client.queue('player_auth_input', {
                pitch: 0, yaw: 0, position: { x: 0, y: 0, z: 0 }, move_vector: { x: 0, z: 0 }, head_yaw: 0,
                input_data: { sneaking: isSneaking, sprinting: false },
                input_mode: 'touch', play_mode: 'normal', interaction_model: 'touch'
            });
        }

        // Global Error / Disconnect Handling
        client.on('error', (err) => {
            console.error('[Client Error Caught]:', err.message);
        });

        client.on('close', (reason) => {
            console.log(`[Disconnect] Server closed connection. Reason: ${reason || 'Unknown'}`);
            scheduleReconnect(15000);
        });

        client.on('end', (reason) => {
            console.log(`[End] Connection ended. Reason: ${reason || 'Unknown'}`);
            scheduleReconnect(15000);
        });

    } catch (err) {
        console.error('[Initialization Error]:', err.message);
        scheduleReconnect(15000);
    }
}

function sendChat(clientObj, text) {
    if (!clientObj) return;
    try {
        clientObj.queue('text', {
            type: 'chat', needs_translation: false, source_name: BOT_NAME,
            xuid: '', platform_chat_id: '', filtered_message: '', message: text
        });
    } catch (e) {
        console.error("Failed to send chat message:", e.message);
    }
}

function stopAll() {
    if (actionInterval) { 
        clearInterval(actionInterval); 
        actionInterval = null; 
    }
}

function scheduleReconnect(delayMs) {
    stopAll();
    isConnecting = false;
    if (client) {
        try { client.close(); } catch (e) {}
        client = null;
    }
    console.log(`Reconnecting in ${delayMs / 1000} seconds...`);
    setTimeout(startBot, delayMs);
}

// Unhandled Crash Prevention
process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception Suppressed]:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection Suppressed]:', reason);
});

// Kick off
startBot();
