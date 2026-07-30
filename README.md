# Pixi Bot 🦆

A Minecraft Bedrock Edition bot with a white duck skin that joins your server and responds to in-game chat commands.

## Deploy to Render (via GitHub)

### 1. Push to GitHub

Create a new GitHub repository and push **only the contents of this folder**:

```bash
git init
git add .
git commit -m "init pixi bot"
git remote add origin https://github.com/YOUR_USERNAME/pixi-bot.git
git push -u origin main
```

### 2. Create a Render Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render will auto-detect `render.yaml` and fill in the settings
4. Click **Create Web Service**

The `render.yaml` sets:
- **Build command:** `npm install`
- **Start command:** `npm start`

### 3. Environment Variables (optional overrides)

Set these in Render's dashboard if you want to change the target server:

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `piximc.aternos.me` | Minecraft server hostname |
| `MC_PORT` | `43180` | Server port |
| `MC_USERNAME` | `pixi` | Bot's username |

---

## In-game Commands

All commands start with `*pixi` (or `*all` for emergency stop):

| Command | Description |
|---|---|
| `*pixi guide1` | Show action commands help |
| `*pixi guide2` | Show item commands help |
| `*pixi guide3` | Show shortcut commands help |
| `*pixi afk!11` | Start AFK mode |
| `*pixi afkX,Y,Z!11` | AFK at specific coordinates |
| `*pixi kill<player>!11` | Attack a nearby player |
| `*pixi mine!11` | Start strip mining |
| `*pixi dropitem!01` | Drop held item |
| `*pixi dropinv!01` | Drop full inventory |
| `*pixi equiparmor!01` | Equip iron armor |
| `*pixi droparmor!01` | Remove armor |
| `*pixi 0` | Emergency stop all actions |
| `*all 0` | Emergency stop (all bots) |

### Shortcuts

| Command | Description |
|---|---|
| `*pixi perm <name> <command>` | Save permanent shortcut to disk |
| `*pixi temp <name> <command>` | Save temporary shortcut (until restart) |
| `*pixi del <name>` | Delete a shortcut |
| `*pixi list` | List all shortcuts |

**Command flags:** `!XY` where `X=1` means careful/safe mode, `Y=1` enables the action (`Y=0` stops it).

---

## Notes

- The bot auto-reconnects 10 seconds after a disconnect
- Permanent shortcuts are saved to `commands.json` in the same directory
- The bot joins in offline mode (no Xbox/Microsoft auth required)
