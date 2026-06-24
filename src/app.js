require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const User = require('./models/User');
const authRoutes      = require('./routes/auth');
const clipRoutes      = require('./routes/clips');
const workspaceRoutes = require('./routes/workspaces');
const drawingRoutes   = require('./routes/drawings');
const resourceRoutes  = require('./routes/resources');
const errorHandler = require('./middleware/errorHandler');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'yahya';

connectDB();

// Ensure the designated admin account has the admin role once the DB is ready
mongoose.connection.once('open', () => {
  User.findOneAndUpdate({ username: ADMIN_USERNAME }, { role: 'admin' }).catch(() => {});
});

const app = express();
const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 12 * 1024 * 1024, // 12 MB — needed for large file clips
  transports: ['websocket', 'polling'],  // WebSocket first; eliminates upgrade round-trip
  pingInterval: 10000,                   // detect dead connections faster (default: 25000)
  pingTimeout:   5000,                   // (default: 20000)
  perMessageDeflate: false,              // JPEG frames are pre-compressed; skip WebSocket deflate
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Active screen-share broadcaster (one at a time)
let activeBroadcaster = null; // { socketId, username }

// userId → { username, profilePic, count }
const onlineUsersMap = new Map();

// userId → { socketId, userId, username, profilePic } — pending screen-share requests
const handRaiseMap = new Map();

function broadcastOnlineUsers() {
  const users = [...onlineUsersMap.values()].map(({ userId, username, profilePic, role }) => ({ userId, username, profilePic, role }));
  io.emit('users:online', { users });
}

function notifyAdmins(event, data) {
  for (const [, s] of io.sockets.sockets) {
    if (s.role === 'admin') s.emit(event, data);
  }
}

function broadcastHandQueue() {
  const queue = [...handRaiseMap.values()].map(({ userId, username, profilePic }) => ({ userId, username, profilePic }));
  notifyAdmins('screen:hand-queue', { queue });
}

// Called by authController when a user updates their profile pic mid-session
function updateOnlineUserPic(userId, profilePic) {
  const entry = onlineUsersMap.get(String(userId));
  if (entry) { entry.profilePic = profilePic; broadcastOnlineUsers(); }
}

io.on('connection', async (socket) => {
  try {
    const userData = await User.findById(socket.userId).select('username profilePic role').lean();
    if (!userData) { socket.disconnect(); return; }
    socket.username   = userData.username;
    socket.profilePic = userData.profilePic || null;
    socket.role       = userData.role || 'user';
  } catch { socket.disconnect(); return; }

  console.log(`Socket connected: ${socket.id} (user: ${socket.username}, role: ${socket.role})`);

  const existing = onlineUsersMap.get(socket.userId);
  if (existing) {
    existing.count++;
  } else {
    onlineUsersMap.set(socket.userId, { userId: socket.userId, username: socket.username, profilePic: socket.profilePic, role: socket.role, count: 1 });
  }
  broadcastOnlineUsers();

  // Tell a newly joined user if someone is already broadcasting
  if (activeBroadcaster) {
    socket.emit('screen:available', activeBroadcaster);
  }

  // Send current hand-raise queue to a newly connected admin
  if (socket.role === 'admin' && handRaiseMap.size > 0) {
    const queue = [...handRaiseMap.values()].map(({ userId, username, profilePic }) => ({ userId, username, profilePic }));
    socket.emit('screen:hand-queue', { queue });
  }

  // ─── Screen share signaling ─────────────────────────────────────────────
  socket.on('screen:start', ({ username }) => {
    activeBroadcaster = { socketId: socket.id, username };
    socket.broadcast.emit('screen:available', activeBroadcaster);
  });

  socket.on('screen:stop', () => {
    if (activeBroadcaster?.socketId === socket.id) {
      activeBroadcaster = null;
      io.emit('screen:ended');
    }
  });

  // Viewer → server → broadcaster: "I want to watch"
  socket.on('screen:join', ({ broadcasterId }) => {
    io.to(broadcasterId).emit('screen:viewer-joined', { viewerId: socket.id });
  });

  // Broadcaster → server → viewer: SDP offer
  socket.on('screen:offer', ({ viewerId, offer }) => {
    io.to(viewerId).emit('screen:offer', { broadcasterId: socket.id, offer });
  });

  // Viewer → server → broadcaster: SDP answer
  socket.on('screen:answer', ({ broadcasterId, answer }) => {
    io.to(broadcasterId).emit('screen:answer', { viewerId: socket.id, answer });
  });

  // Both directions: ICE candidates
  socket.on('screen:ice', ({ targetId, candidate }) => {
    io.to(targetId).emit('screen:ice', { fromId: socket.id, candidate });
  });

  // Canvas-frame fallback (for old browsers where WebRTC ICE fails)
  // Viewer opts into fallback room so broadcaster can target frames at them only
  socket.on('screen:watch-fallback', ({ broadcasterId }) => {
    socket.join(`fallback:${broadcasterId}`);
    io.to(broadcasterId).emit('screen:fallback-viewer');
  });

  socket.on('screen:leave-fallback', ({ broadcasterId }) => {
    socket.leave(`fallback:${broadcasterId}`);
  });

  // Broadcaster emits a JPEG frame; server relays only to fallback viewers
  socket.on('screen:frame', ({ frame }) => {
    socket.to(`fallback:${socket.id}`).emit('screen:frame', { frame });
  });

  // Viewer requests a quality change; relay to broadcaster with viewer identity
  socket.on('screen:quality-request', ({ broadcasterId, preset }) => {
    io.to(broadcasterId).emit('screen:quality-request', { viewerId: socket.id, preset });
  });

  // ─── Screen share permission (raise hand) ───────────────────────────────
  socket.on('screen:raise-hand', () => {
    if (socket.role === 'admin') return; // admin never needs permission
    handRaiseMap.set(socket.userId, {
      socketId:   socket.id,
      userId:     socket.userId,
      username:   socket.username,
      profilePic: socket.profilePic,
    });
    // Check if any admin is online; if not, tell the requester immediately
    let adminOnline = false;
    for (const [, s] of io.sockets.sockets) {
      if (s.role === 'admin') { adminOnline = true; break; }
    }
    if (!adminOnline) {
      socket.emit('screen:no-admin');
    }
    // Alert every admin with a dedicated event so they can show a prominent notification
    notifyAdmins('screen:hand-raised', {
      userId:     socket.userId,
      username:   socket.username,
      profilePic: socket.profilePic,
    });
    broadcastHandQueue();
  });

  socket.on('screen:lower-hand', () => {
    handRaiseMap.delete(socket.userId);
    broadcastHandQueue();
  });

  socket.on('screen:approve', ({ userId }) => {
    if (socket.role !== 'admin') return;
    const entry = handRaiseMap.get(userId);
    if (!entry) return;
    handRaiseMap.delete(userId);
    io.to(entry.socketId).emit('screen:approved');
    broadcastHandQueue();
  });

  socket.on('screen:deny', ({ userId }) => {
    if (socket.role !== 'admin') return;
    const entry = handRaiseMap.get(userId);
    if (!entry) return;
    handRaiseMap.delete(userId);
    io.to(entry.socketId).emit('screen:denied');
    broadcastHandQueue();
  });

  // ─── Admin-only events ───────────────────────────────────────────────────
  socket.on('screen:admin-stop', () => {
    if (socket.role !== 'admin' || !activeBroadcaster) return;
    io.to(activeBroadcaster.socketId).emit('screen:force-stop');
    activeBroadcaster = null;
    io.emit('screen:ended');
  });

  socket.on('user:kick', ({ userId }) => {
    if (socket.role !== 'admin') return;
    for (const [, s] of io.sockets.sockets) {
      if (s.userId === userId && s.id !== socket.id) {
        s.emit('kicked');
        s.disconnect(true);
      }
    }
  });

  socket.on('disconnect', () => {
    if (activeBroadcaster?.socketId === socket.id) {
      activeBroadcaster = null;
      io.emit('screen:ended');
    }
    // Clean up hand-raise queue if disconnecting user had a pending request
    if (handRaiseMap.has(socket.userId)) {
      handRaiseMap.delete(socket.userId);
      broadcastHandQueue();
    }
    const entry = onlineUsersMap.get(socket.userId);
    if (entry) {
      entry.count--;
      if (entry.count <= 0) onlineUsersMap.delete(socket.userId);
    }
    broadcastOnlineUsers();
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ─── Trust proxy (required on Render / any reverse-proxy host) ───────────────
app.set('trust proxy', 1);

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — please slow down' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts — try again in an hour' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Inject io + helpers into every request ───────────────────────────────────
app.use((req, _res, next) => {
  req.io = io;
  req.updateOnlineUserPic = updateOnlineUserPic;
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/drawings',  drawingRoutes);
app.use('/api/resources', resourceRoutes);

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = { app, io };
