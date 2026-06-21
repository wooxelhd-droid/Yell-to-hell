// ============================================================
//  YELL TO HELL — WebSocket Matchmaking Server
//  Deployen auf Railway.app (kostenlos!)
// ============================================================

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// HTTP Server (needed for Railway health checks)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🔥 YELL TO HELL SERVER — ONLINE\n');
});

const wss = new WebSocketServer({ server });

// State
const waitingPlayers = []; // [{ws, name, id}]
const rooms = new Map();   // roomId -> {p1, p2}

let playerIdCounter = 0;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function genRoomId() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {}
}

wss.on('connection', (ws) => {
  const playerId = ++playerIdCounter;
  ws.playerId = playerId;
  ws.playerName = 'NoName!';
  ws.roomId = null;
  ws.isAlive = true;

  log(`Player #${playerId} connected (total: ${wss.clients.size})`);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {

      case 'join': {
        ws.playerName = (msg.name || 'NoName!').slice(0, 20);
        log(`#${playerId} "${ws.playerName}" looking for match`);

        // Check if someone's waiting
        if (waitingPlayers.length > 0) {
          const opponent = waitingPlayers.shift();

          // Make sure opponent is still connected
          if (opponent.ws.readyState !== opponent.ws.OPEN) {
            // Opponent disconnected, add self to queue
            waitingPlayers.push({ ws, name: ws.playerName, id: playerId });
            break;
          }

          const roomId = genRoomId();
          ws.roomId = roomId;
          opponent.ws.roomId = roomId;

          rooms.set(roomId, {
            p1: opponent.ws,
            p2: ws,
          });

          log(`Room ${roomId}: "${opponent.name}" vs "${ws.playerName}"`);

          // Notify both players
          safeSend(opponent.ws, {
            type: 'matched',
            roomId,
            enemyName: ws.playerName,
          });
          safeSend(ws, {
            type: 'matched',
            roomId,
            enemyName: opponent.name,
          });

        } else {
          // Add to waiting queue
          waitingPlayers.push({ ws, name: ws.playerName, id: playerId });
          log(`#${playerId} "${ws.playerName}" waiting... (queue: ${waitingPlayers.length})`);
        }
        break;
      }

      case 'volume': {
        const roomId = msg.roomId || ws.roomId;
        if (!roomId) break;
        const room = rooms.get(roomId);
        if (!room) break;

        // Forward volume to the opponent
        const opponent = room.p1 === ws ? room.p2 : room.p1;
        safeSend(opponent, {
          type: 'volume',
          volume: Math.min(1, Math.max(0, Number(msg.volume) || 0)),
        });
        break;
      }

      case 'result': {
        // Optional: server-side result logging
        log(`Room ${ws.roomId}: result submitted by #${playerId}`);
        break;
      }
    }
  });

  ws.on('close', () => {
    log(`Player #${playerId} "${ws.playerName}" disconnected`);

    // Remove from waiting queue
    const idx = waitingPlayers.findIndex(p => p.id === playerId);
    if (idx !== -1) waitingPlayers.splice(idx, 1);

    // Notify room partner
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      if (room) {
        const opponent = room.p1 === ws ? room.p2 : room.p1;
        safeSend(opponent, { type: 'opponentLeft' });
        rooms.delete(ws.roomId);
      }
    }
  });

  ws.on('error', (err) => {
    log(`Error on #${playerId}:`, err.message);
  });
});

// Heartbeat — ping all clients every 25s
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  log(`🔥 YELL TO HELL Server running on port ${PORT}`);
  log(`   Players online: 0`);
});
