const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const STATIC_ROOMS = ['room1', 'room2', 'room3', 'room4'];
const MAX_USERS = 4;

const roomUsers = {}; // { roomName: [socketId1, socketId2] }
const rooms = {};     // { roomName: { hostId: string, streamers: [] } }

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🔗 WebRTC Signaling Server is live!');
});

io.on('connection', (socket) => {
  console.log(`🔌 New user connected: ${socket.id}`);

  socket.on('getRooms', () => {
    const roomsStatus = STATIC_ROOMS.map((room) => ({
      name: room,
      count: roomUsers[room]?.length || 0,
      full: (roomUsers[room]?.length || 0) >= MAX_USERS,
    }));
    socket.emit('roomsList', roomsStatus);
  });

  socket.on('joinRoom', (roomName) => {
    if (!STATIC_ROOMS.includes(roomName)) return;

    roomUsers[roomName] = roomUsers[roomName] || [];
    rooms[roomName] = rooms[roomName] || { hostId: null, streamers: [] };

    if (roomUsers[roomName].length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
    }

    // Assign host if first to join
    if (!rooms[roomName].hostId) {
      rooms[roomName].hostId = socket.id;
      io.to(socket.id).emit('role', 'host');
    } else {
      io.to(socket.id).emit('role', 'viewer');
    }

    socket.join(roomName);
    roomUsers[roomName].push(socket.id);

    const otherUsers = roomUsers[roomName].filter(id => id !== socket.id);
    socket.emit('joined', { room: roomName, users: otherUsers });

    otherUsers.forEach(userId => {
      io.to(userId).emit('newUser', socket.id);
    });

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('streamRequest', () => {
      const room = findUserRoom(socket.id);
      if (room && rooms[room].hostId) {
        io.to(rooms[room].hostId).emit('streamRequest', socket.id);
      }
    });

    socket.on('streamApproved', (viewerId) => {
      const room = findUserRoom(viewerId);
      if (room) {
        if (!rooms[room].streamers.includes(viewerId)) {
          rooms[room].streamers.push(viewerId);
          io.to(viewerId).emit('startStream');

          // Connect new streamer to everyone
          roomUsers[room].forEach(userId => {
            if (userId !== viewerId) {
              io.to(userId).emit('newUser', viewerId);
              io.to(viewerId).emit('newUser', userId);
            }
          });
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.id}`);

      for (const roomName of STATIC_ROOMS) {
        if (roomUsers[roomName]) {
          roomUsers[roomName] = roomUsers[roomName].filter(id => id !== socket.id);
        }

        if (rooms[roomName]?.hostId === socket.id) {
          rooms[roomName].hostId = null; // Promote logic can be added
        }

        if (rooms[roomName]?.streamers) {
          rooms[roomName].streamers = rooms[roomName].streamers.filter(id => id !== socket.id);
        }

        socket.to(roomName).emit('userLeft', socket.id);
      }
    });
  });
});

// Helper: Find room for user
function findUserRoom(socketId) {
  for (const roomName of STATIC_ROOMS) {
    if (roomUsers[roomName]?.includes(socketId)) {
      return roomName;
    }
  }
  return null;
}

server.listen(PORT, () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
});
