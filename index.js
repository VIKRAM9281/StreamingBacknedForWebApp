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

const roomUsers = {}; // roomName: [socketId...]
const rooms = {};     // roomName: { hostId: '', streamers: [] }

app.use(cors());
app.get('/', (req, res) => {
  res.send('WebRTC Signaling Server Active!');
});

io.on('connection', (socket) => {
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

    if (!rooms[roomName].hostId) {
      rooms[roomName].hostId = socket.id;
      socket.emit('role', 'host');
    } else {
      socket.emit('role', 'viewer');
    }

    roomUsers[roomName].push(socket.id);
    socket.join(roomName);

    const otherUsers = roomUsers[roomName].filter(id => id !== socket.id);
    socket.emit('joined', { room: roomName, users: otherUsers });

    otherUsers.forEach(id => io.to(id).emit('newUser', socket.id));

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('streamRequest', () => {
      const room = findUserRoom(socket.id);
      if (room) {
        io.to(rooms[room].hostId).emit('streamRequest', socket.id);
      }
    });

    socket.on('streamApproved', (viewerId) => {
      const room = findUserRoom(viewerId);
      if (room && !rooms[room].streamers.includes(viewerId)) {
        rooms[room].streamers.push(viewerId);
        io.to(viewerId).emit('startStream');

        roomUsers[room].forEach(userId => {
          if (userId !== viewerId) {
            io.to(userId).emit('newUser', viewerId);
            io.to(viewerId).emit('newUser', userId);
          }
        });
      }
    });

    socket.on('disconnect', () => {
      for (const room of STATIC_ROOMS) {
        roomUsers[room] = (roomUsers[room] || []).filter(id => id !== socket.id);
        if (rooms[room]?.hostId === socket.id) rooms[room].hostId = null;
        rooms[room].streamers = (rooms[room]?.streamers || []).filter(id => id !== socket.id);
        io.to(room).emit('userLeft', socket.id);
      }
    });
  });
});

function findUserRoom(socketId) {
  return STATIC_ROOMS.find(room => roomUsers[room]?.includes(socketId));
}

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
