const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins, change in production
    methods: ['GET', 'POST']
  }
});

const PORT = 6000;
const MAX_USERS = 4;
const STATIC_ROOMS = ['room1', 'room2', 'room3', 'room4'];
let roomUsers = {}; // e.g., { room1: [socketId1, socketId2] }

app.use(cors());
app.use(express.json());

// Optional: serve Vite build in production
// app.use(express.static('dist'));
// app.get('*', (req, res) => res.sendFile(__dirname + '/dist/index.html'));

io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  socket.on('getRooms', () => {
    const roomsStatus = STATIC_ROOMS.map(room => ({
      name: room,
      count: roomUsers[room]?.length || 0,
      full: (roomUsers[room]?.length || 0) >= MAX_USERS
    }));
    socket.emit('roomsList', roomsStatus);
  });

  socket.on('joinRoom', (roomName) => {
    if (!STATIC_ROOMS.includes(roomName)) return;
    roomUsers[roomName] = roomUsers[roomName] || [];

    if (roomUsers[roomName].length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
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

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.id}`);
      roomUsers[roomName] = (roomUsers[roomName] || []).filter(id => id !== socket.id);
      socket.to(roomName).emit('userLeft', socket.id);
    });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running at http://localhost:${PORT}`);
});
