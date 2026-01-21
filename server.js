const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const { Server } = require("socket.io");

const app = express();
app.use(helmet({
  contentSecurityPolicy: false, // allow inline styles/scripts for simple static setup
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  // If you deploy behind a proxy (Render/Fly), Socket.IO works fine with defaults.
  // If you need CORS, set it here.
});

app.use(express.static(path.join(__dirname, "public")));

// --- In-memory room state (simple + fast). For multi-instance scaling, use Redis adapter.
const rooms = new Map(); // roomCode -> { hostId, participants: Map(socketId -> {name, role, joinedAt}) }

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I for readability
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function getOrCreateRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, { hostId: null, participants: new Map() });
  }
  return rooms.get(roomCode);
}

function roomSnapshot(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const participants = [];
  for (const [id, p] of room.participants.entries()) {
    participants.push({ id, name: p.name, role: p.role, joinedAt: p.joinedAt });
  }
  participants.sort((a, b) => a.joinedAt - b.joinedAt);
  return { roomCode, hostId: room.hostId, participants };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "watch-party-by-skye", time: new Date().toISOString() });
});

app.post("/api/new-room", (_req, res) => {
  let code = generateRoomCode();
  let attempts = 0;
  while (rooms.has(code) && attempts < 20) {
    code = generateRoomCode();
    attempts++;
  }
  getOrCreateRoom(code);
  res.json({ roomCode: code });
});

// --- Socket.IO
io.on("connection", (socket) => {
  // Join
  socket.on("join-room", ({ roomCode, name, role }) => {
    if (!roomCode || typeof roomCode !== "string") return;
    roomCode = roomCode.trim().toUpperCase();

    if (!name || typeof name !== "string") name = "Guest";
    name = name.trim().slice(0, 24) || "Guest";

    if (!role || (role !== "host" && role !== "viewer")) role = "viewer";

    const room = getOrCreateRoom(roomCode);

    // If someone tries to become host but host exists, force viewer
    if (role === "host" && room.hostId && room.hostId !== socket.id) {
      role = "viewer";
      socket.emit("system-toast", { type: "warn", message: "Host already exists. You joined as a viewer." });
    }

    // If you are host, set hostId
    if (role === "host") {
      room.hostId = socket.id;
    }

    room.participants.set(socket.id, { name, role, joinedAt: Date.now() });
    socket.data.roomCode = roomCode;
    socket.data.role = role;
    socket.data.name = name;

    socket.join(roomCode);

    // Send snapshot to everyone
    io.to(roomCode).emit("room-state", roomSnapshot(roomCode));

    // Notify host when a viewer joins
    if (role === "viewer" && room.hostId) {
      io.to(room.hostId).emit("viewer-joined", { viewerId: socket.id });
    }

    // Let the joiner know current host
    socket.emit("host-status", { hostId: room.hostId });
  });

  // Chat
  socket.on("chat-message", ({ roomCode, text }) => {
    if (!roomCode) roomCode = socket.data.roomCode;
    if (!roomCode) return;

    if (!text || typeof text !== "string") return;
    text = text.trim();
    if (!text) return;
    if (text.length > 500) text = text.slice(0, 500);

    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: socket.data.name || "Guest",
      role: socket.data.role || "viewer",
      text,
      at: Date.now(),
    };
    io.to(roomCode).emit("chat-message", payload);
  });

  // Host broadcast: "we are viewing this URL"
  socket.on("host-url", ({ roomCode, url }) => {
    if (!roomCode) roomCode = socket.data.roomCode;
    if (!roomCode) return;

    if (!url || typeof url !== "string") return;
    url = url.trim().slice(0, 2000);
    io.to(roomCode).emit("host-url", { url, at: Date.now() });
  });

  // WebRTC signaling: offer / answer / ice (targeted)
  socket.on("webrtc-offer", ({ to, sdp }) => {
    if (!to || !sdp) return;
    io.to(to).emit("webrtc-offer", { from: socket.id, sdp });
  });

  socket.on("webrtc-answer", ({ to, sdp }) => {
    if (!to || !sdp) return;
    io.to(to).emit("webrtc-answer", { from: socket.id, sdp });
  });

  socket.on("webrtc-ice", ({ to, candidate }) => {
    if (!to || !candidate) return;
    io.to(to).emit("webrtc-ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.participants.delete(socket.id);

    // If host left, clear hostId and notify
    if (room.hostId === socket.id) {
      room.hostId = null;
      io.to(roomCode).emit("host-left", { at: Date.now() });
    }

    // If room empty, delete
    if (room.participants.size === 0) {
      rooms.delete(roomCode);
      return;
    }

    // Update snapshot
    io.to(roomCode).emit("room-state", roomSnapshot(roomCode));
  });
});

server.listen(PORT, () => {
  console.log(`Watch-Party by Skye <3 running on http://localhost:${PORT}`);
});
