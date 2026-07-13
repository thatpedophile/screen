import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

interface Room {
  streamId: string;
  password?: string;
  streamerSocket: WebSocket | null;
  watcherSockets: Map<string, WebSocket>; // watcherId -> WebSocket
}

interface ClientSession {
  ws: WebSocket;
  role: 'streamer' | 'watcher';
  streamId: string;
  watcherId?: string; // only for watchers
}

const PORT = 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const rooms = new Map<string, Room>();
const activeSessions = new Map<WebSocket, ClientSession>();

// Parse JSON bodies for API requests
app.use(express.json());

// Upgrade standard HTTP connections to WebSockets on port 3000
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// REST API Health endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeRooms: rooms.size });
});

// Verify credentials before trying to connect
app.post("/api/verify-stream", (req, res) => {
  const { streamId, password } = req.body;
  if (!streamId) {
    return res.status(400).json({ success: false, error: "Stream ID is required." });
  }

  const room = rooms.get(streamId);
  if (!room) {
    return res.status(404).json({ success: false, error: "Stream Room not found." });
  }

  if (room.password && room.password !== password) {
    return res.status(401).json({ success: false, error: "Incorrect password." });
  }

  return res.json({ success: true, streamerActive: room.streamerSocket !== null });
});

// WebSocket message handling
wss.on("connection", (ws: WebSocket) => {
  console.log("New WebSocket client connected");

  ws.on("message", (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      
      switch (msg.type) {
        case "create_room": {
          const { streamId, password } = msg;
          if (!streamId) {
            ws.send(JSON.stringify({ type: "error", message: "Stream ID is required." }));
            return;
          }

          let room = rooms.get(streamId);
          if (room && room.streamerSocket) {
            ws.send(JSON.stringify({ type: "error", message: "Room is already active with an ongoing stream." }));
            return;
          }

          if (!room) {
            room = {
              streamId,
              password: password || "",
              streamerSocket: ws,
              watcherSockets: new Map(),
            };
            rooms.set(streamId, room);
          } else {
            // Re-assign or update an existing room
            room.streamerSocket = ws;
            if (password !== undefined) {
              room.password = password;
            }
          }

          activeSessions.set(ws, { ws, role: "streamer", streamId });
          ws.send(JSON.stringify({ type: "room_created", streamId }));
          console.log(`Stream room "${streamId}" created/resumed by streamer.`);
          break;
        }

        case "join_room": {
          const { streamId, password } = msg;
          if (!streamId) {
            ws.send(JSON.stringify({ type: "error", message: "Stream ID is required." }));
            return;
          }

          const room = rooms.get(streamId);
          if (!room) {
            ws.send(JSON.stringify({ type: "error", message: "Stream room not found." }));
            return;
          }

          if (room.password && room.password !== password) {
            ws.send(JSON.stringify({ type: "error", message: "Incorrect password." }));
            return;
          }

          // Generate a unique watcher ID
          const watcherId = "watcher_" + Math.random().toString(36).substring(2, 11);
          room.watcherSockets.set(watcherId, ws);
          activeSessions.set(ws, { ws, role: "watcher", streamId, watcherId });

          // Notify the Watcher they joined successfully
          ws.send(JSON.stringify({
            type: "room_joined",
            streamId,
            watcherId,
            streamerActive: room.streamerSocket !== null,
          }));

          console.log(`Watcher "${watcherId}" joined Room "${streamId}".`);

          // Notify the Streamer that a Watcher has joined
          if (room.streamerSocket) {
            room.streamerSocket.send(JSON.stringify({ type: "watcher_joined", watcherId }));
          }
          break;
        }

        case "signal": {
          const session = activeSessions.get(ws);
          if (!session) {
            ws.send(JSON.stringify({ type: "error", message: "Not authenticated/registered in any room." }));
            return;
          }

          const { role, streamId, watcherId } = session;
          const room = rooms.get(streamId);
          if (!room) return;

          if (role === "streamer") {
            // Streamer sending signaling info to a specific Watcher
            const { targetId, signalData } = msg;
            if (targetId) {
              const watcherWs = room.watcherSockets.get(targetId);
              if (watcherWs && watcherWs.readyState === WebSocket.OPEN) {
                watcherWs.send(JSON.stringify({
                  type: "signal",
                  senderId: "streamer",
                  signalData,
                }));
              }
            }
          } else if (role === "watcher" && watcherId) {
            // Watcher sending signaling info to the Streamer
            const { signalData } = msg;
            if (room.streamerSocket && room.streamerSocket.readyState === WebSocket.OPEN) {
              room.streamerSocket.send(JSON.stringify({
                type: "signal",
                senderId: watcherId,
                signalData,
              }));
            }
          }
          break;
        }

        default:
          console.warn(`Unrecognized WebSocket event: ${msg.type}`);
          ws.send(JSON.stringify({ type: "error", message: `Unsupported action: ${msg.type}` }));
      }
    } catch (err) {
      console.error("Failed to process WebSocket message:", err);
      ws.send(JSON.stringify({ type: "error", message: "Malformed payload." }));
    }
  });

  ws.on("close", () => {
    const session = activeSessions.get(ws);
    if (!session) return;

    const { role, streamId, watcherId } = session;
    activeSessions.delete(ws);

    const room = rooms.get(streamId);
    if (room) {
      if (role === "streamer") {
        room.streamerSocket = null;
        console.log(`Streamer left Room "${streamId}".`);

        // Notify all watchers that the streamer left
        const broadcastMsg = JSON.stringify({ type: "streamer_left" });
        for (const watcherWs of room.watcherSockets.values()) {
          if (watcherWs.readyState === WebSocket.OPEN) {
            watcherWs.send(broadcastMsg);
          }
        }

        // Clean up the room if empty
        if (room.watcherSockets.size === 0) {
          rooms.delete(streamId);
          console.log(`Room "${streamId}" destroyed because it is empty.`);
        }
      } else if (role === "watcher" && watcherId) {
        room.watcherSockets.delete(watcherId);
        console.log(`Watcher "${watcherId}" disconnected from Room "${streamId}".`);

        // Notify streamer
        if (room.streamerSocket && room.streamerSocket.readyState === WebSocket.OPEN) {
          room.streamerSocket.send(JSON.stringify({ type: "watcher_left", watcherId }));
        }

        // Clean up room if empty
        if (room.watcherSockets.size === 0 && !room.streamerSocket) {
          rooms.delete(streamId);
          console.log(`Room "${streamId}" destroyed because it is empty.`);
        }
      }
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket socket error:", err);
  });
});

// Configure Vite integration or static file rendering
async function setupViteAndListen() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT} [${process.env.NODE_ENV || "development"} mode]`);
  });
}

setupViteAndListen().catch((err) => {
  console.error("Critical error starting application server:", err);
});
