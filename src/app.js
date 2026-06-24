require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const clipRoutes = require('./routes/clips');
const workspaceRoutes = require('./routes/workspaces');
const errorHandler = require('./middleware/errorHandler');

connectDB();

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

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

  // Tell a newly joined user if someone is already broadcasting
  if (activeBroadcaster) {
    socket.emit('screen:available', activeBroadcaster);
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

  socket.on('disconnect', () => {
    if (activeBroadcaster?.socketId === socket.id) {
      activeBroadcaster = null;
      io.emit('screen:ended');
    }
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

// ─── Inject io into every request ────────────────────────────────────────────
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/workspaces', workspaceRoutes);

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
