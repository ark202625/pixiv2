const bedrock = require('bedrock-protocol');
const fs = require('fs');
const path = require('path');
const express = require('express');

// --- HEALTH CHECK WEB SERVER ---
const app = express();
const PORT = process.env.PORT || 8000;

app.get('/', (req, res) => {
    res.send('Pixi Bedrock Bot is running successfully!');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT} for health checks.`);
});

// Target Server Config
const HOST = process.env.MC_HOST || 'icefish.aternos.host';
const PORT_MC = parseInt(process.env.MC_PORT) || 43180;
const BOT_NAME = process.env.MC_USERNAME || 'pixi'; 

// Permanent Storage File Path
const STORAGE_FILE = path.join(__dirname, 'commands.json');

// --- DUCK SKIN GENERATOR (Exact White Duck Texture Array) ---
function generateWhiteDuckSkin() {
    const width = 64;
    const height = 64;
    const buf = Buffer.alloc(width * height * 4);

    // Color definitions in RGBA
    const WHITE  = [255, 255, 255, 255];
    const YELLOW = [255, 180, 0, 255];   // Beak
    const ORANGE = [230, 100, 0, 255];   // Feet
    const EYE    = [20, 20, 20, 255];     // Eyes
    const SHADOW = [220, 220, 220, 255]; // Feather shading

    // Fill base skin with white feathers
    for (let i = 0; i < buf.length; i += 4) {
        buf[i]     = WHITE[0];
        buf[i + 1] = WHITE[1];
        buf[i + 2] = WHITE[2];
        buf[i + 3] = WHITE[3];
    }

    function drawPixel(x, y, color) {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = (y * width + x) * 4;
        buf[idx]     = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = color[3];
    }

    function fillRect(x1, y1, x2, y2, color) {
        for (let x = x1; x <= x2; x++) {
            for (let y = y1; y <= y2; y++) {
                drawPixel(x, y, color);
            }
        }
    }

    // 1. Duck Face Details (Head Front: X=8..15, Y=8..15)
    drawPixel(9, 11, EYE);   // Left Eye
    drawPixel(14, 11, EYE);  // Right Eye
    fillRect(9, 13, 14, 14, YELLOW); // Duck Beak

    // 2. Duck Feet Details (Legs Bottom: Y=20..31 and Y=48..63)
    fillRect(0, 28, 15, 31, ORANGE);  // Left Foot
    fillRect(16, 28, 31, 31, ORANGE); // Right Foot

    // 3. Wing Accents (Arm Sides)
    fillRect(40, 20, 43, 31, SHADOW); 
    fillRect(48, 20, 51, 31, SHADOW);

    return {
        skinId: "ExactWhiteDuck",
        skinData: buf,
        skinImageWidth: width,
        skinImageHeight: height,
        capeData: Buffer.alloc(0)
    };
}

// --- PERMANENT COMMAND STORAGE ---
function loadPermanentCommands() {
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const data = fs.readFileSync(STORAGE_FILE, 'utf8');
            return new Map(Object.entries(JSON.parse(data)));
        }
    } catch (err) {
        console.error("Error reading commands.json:", err.message);
    }
    return new Map();
}

function savePermanentCommands(permMap) {
    try {
        const obj = Object.fromEntries(permMap);
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
        console.error("Error saving commands.json:", err.message);
    }
}

// --- BOT STARTUP & LOGIC ---
function startBot() {
    console.log(`Connecting Bedrock bot '${BOT_NAME}' to ${HOST}:${PORT_MC}...`);

    const client = bedrock.createClient({
        host: HOST,
        port: PORT_MC,
        username: BOT_NAME,
        offline: true,
        skipPing: true,
        version: '1.20.40',          // Aligned with installed bedrock-protocol package limit
        raknetBackend: 'jsp-raknet', // Fixes C++ build failures on Render/Termux
        connectTimeout: 30000,
        skinData: generateWhiteDuckSkin()
    });

    // Lifecycle Events
    client.on('connect', () => {
        console.log("RakNet connected.");
    });

    client.on('join', () => {
        console.log("Successfully joined the world.");
    });

    client.on('disconnect', (packet) => {
        console.log("Disconnect packet:", packet);
    });

    // Storage Maps
    const permShortcuts = loadPermanentCommands();
    const tempShortcuts = new Map();
    const nearbyPlayers = new Map();
    const nearbyMobs = new Map();

    // Loops & States
    let actionInterval = null;
    let priorityTarget = 'pixelbrine';
    let isSneaking = false;

    client.on('spawn', () => {
        console.log(`[+] ${BOT_NAME} connected!`);
        sendChat(client, `${BOT_NAME} online! Type '*${BOT_NAME} guide1' for help.`);
    });

    // Track Entities
    client.on('add_player', (p) => nearbyPlayers.set(p.username.toLowerCase(), { id: p.runtime_id, pos: p.position }));
    client.on('add_actor', (m) => nearbyMobs.set(m.runtime_id, { type: m.type, pos: m.position }));
    client.on('remove_actor', (p) => {
        for (const [name, data] of nearbyPlayers.entries()) {
            if (data.id === p.entity_unique_id) nearbyPlayers.delete(name);
        }
        nearbyMobs.delete(p.entity_unique_id);
    });

    // Chat Processing
    client.on('text', (packet) => {
        if (packet.source_name === BOT_NAME) return;
        const rawMsg = (packet.message || '').trim();
        const sender = packet.source_name;

        // 1. Check Temporary Shortcuts
        if (tempShortcuts.has(rawMsg.toLowerCase())) {
            parseCommand(tempShortcuts.get(rawMsg.toLowerCase()), sender);
            return;
        }

        // 2. Check Permanent Shortcuts
        if (permShortcuts.has(rawMsg.toLowerCase())) {
            parseCommand(permShortcuts.get(rawMsg.toLowerCase()), sender);
            return;
        }

        // 3. Process Standard Commands
        parseCommand(rawMsg, sender);
    });

    function parseCommand(rawMsg, sender) {
        if (!rawMsg.startsWith('*')) return;

        const cleanMsg = rawMsg.toLowerCase();

        // Master Stop
        if (cleanMsg === `*${BOT_NAME.toLowerCase()} 0` || cleanMsg === '*all 0') {
            stopAll();
            sendChat(client, 'Stopped all actions.');
            return;
        }

        // Create Permanent Shortcut: *pixi perm <shortcut> <full_command>
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

        // Create Temporary Shortcut: *pixi temp <shortcut> <full_command>
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

        // Delete Shortcut: *pixi del <shortcut>
        if (cleanMsg.startsWith(`*${BOT_NAME.toLowerCase()} del`)) {
            const parts = rawMsg.split(' ');
            const sc = parts[2] ? parts[2].toLowerCase() : '';
            let deleted = false;
            if (tempShortcuts.has(sc)) { tempShortcuts.delete(sc); deleted = true; }
            if (permShortcuts.has(sc)) { permShortcuts.delete(sc); savePermanentCommands(permShortcuts); deleted = true; }
            sendChat(client, deleted ? `Deleted shortcut '${sc}'.` : `Shortcut '${sc}' not found.`);
            return;
        }

        // List Shortcuts: *pixi list
        if (cleanMsg === `*${BOT_NAME.toLowerCase()} list`) {
            const pKeys = Array.from(permShortcuts.keys()).join(', ') || 'None';
            const tKeys = Array.from(tempShortcuts.keys()).join(', ') || 'None';
            sendChat(client, `Perm: [${pKeys}] | Temp: [${tKeys}]`);
            return;
        }

        // Help Guides
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

        // Command Body Parsing
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

    function stopAll() {
        if (actionInterval) { clearInterval(actionInterval); actionInterval = null; }
        isSneaking = false;
    }

    client.on('error', (e) => {
        console.error("=== FULL ERROR ===");
        console.error(e);
        console.error("==================");
    });

    client.on('close', (reason) => {
        stopAll();
        console.log("Connection closed:", reason);
        console.log("Reconnecting in 10 seconds...");
        setTimeout(startBot, 10000);
    });
}

function sendChat(client, text) {
    client.queue('text', {
        type: 'chat', needs_translation: false, source_name: BOT_NAME,
        xuid: '', platform_chat_id: '', filtered_message: '', message: text
    });
}

startBot();
