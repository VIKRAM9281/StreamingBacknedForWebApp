const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // or set to 'http://localhost:5173' for Vite
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
app.use(cors({
  origin: '*', // Or match your frontend
  credentials: true,
}));


const PORT = process.env.PORT || 3001;

const MAX_USERS = 4;
const STATIC_ROOMS = ['room1', 'room2', 'room3', 'room4'];
let roomUsers = {}; // { room1: [socketId1, socketId2] }
let socketRoomMap = {}; // socket.id => room name
let roomHosts = {};     // room name => host socket.id

io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

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
    socketRoomMap[socket.id] = roomName;
    roomUsers[roomName].push(socket.id);

    // assign host if first user
    if (roomUsers[roomName].length === 1) {
      roomHosts[roomName] = socket.id;
    }

    const otherUsers = roomUsers[roomName].filter(id => id !== socket.id);
    socket.emit('joined', { room: roomName, users: otherUsers });

    // notify host that a new user wants to stream
    otherUsers.forEach(userId => {
      io.to(userId).emit('newUser', socket.id);
    });
  });

  // 🔄 Host approves a stream request
  socket.on('streamApproved', ({ to }) => {
    io.to(to).emit('streamApproved');
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    const roomName = socketRoomMap[socket.id];
    if (roomName) {
      roomUsers[roomName] = roomUsers[roomName]?.filter(id => id !== socket.id);
      delete socketRoomMap[socket.id];

      // if host left, remove host (or reassign if needed)
      if (roomHosts[roomName] === socket.id) {
        delete roomHosts[roomName];
        if (roomUsers[roomName]?.length) {
          // Reassign to the next user
          roomHosts[roomName] = roomUsers[roomName][0];
          console.log(`🔁 Host reassigned to ${roomHosts[roomName]}`);
        }
      }

      socket.to(roomName).emit('userLeft', socket.id);
    }
  });
});

http.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});
