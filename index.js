const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const MAX_VIEWERS = 10;
const rooms = {};
const socketToRoom = {};

app.use(cors());

app.get('/', (req, res) => {
  res.send('Stream server is running successfully');
});

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  socket.on('create-room', ({ roomId, userName }) => {
    if (!roomId || !userName || typeof roomId !== 'string' || typeof userName !== 'string') {
      socket.emit('invalid-room');
      return;
    }

    if (rooms[roomId]) {
      socket.emit('room-exists');
      return;
    }

    rooms[roomId] = {
      hostId: socket.id,
      viewers: new Set(),
      isStreaming: false,
      isHostReady: false,
      messages: [],
      users: { [socket.id]: userName },
    };

    socketToRoom[socket.id] = roomId;
    socket.join(roomId);

    socket.emit('room-created', { roomId });
    emitRoomInfo(roomId);
  });

  socket.on('join-room', ({ roomId, userName }) => {
    if (!roomId || !userName || typeof roomId !== 'string' || typeof userName !== 'string') {
      socket.emit('invalid-room');
      return;
    }

    if (!rooms[roomId]) {
      socket.emit('invalid-room');
      return;
    }

    if (rooms[roomId].viewers.size >= MAX_VIEWERS) {
      socket.emit('room-full');
      return;
    }

    rooms[roomId].viewers.add(socket.id);
    rooms[roomId].users[socket.id] = userName;
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);

    socket.emit('room-joined', {
      roomId,
      hostId: rooms[roomId].hostId,
      isHostStreaming: rooms[roomId].isStreaming,
      viewerCount: rooms[roomId].viewers.size,
      users: rooms[roomId].users,
    });

    if (rooms[roomId].isHostReady) {
      io.to(roomId).emit('user-joined', { userId: socket.id, userName });
    }

    if (rooms[roomId].isStreaming) {
      socket.emit('host-started-streaming');
    }

    emitRoomInfo(roomId);
  });

  socket.on('host-streaming', (roomId) => {
    if (!rooms[roomId] || rooms[roomId].hostId !== socket.id) {
      return;
    }

    rooms[roomId].isStreaming = true;
    rooms[roomId].isHostReady = true;
    rooms[roomId].viewers.forEach((viewerId) => {
      io.to(viewerId).emit('host-started-streaming');
    });
    emitRoomInfo(roomId);
  });

  socket.on('stop-streaming', (roomId) => {
    if (!rooms[roomId] || rooms[roomId].hostId !== socket.id) {
      return;
    }

    rooms[roomId].isStreaming = false;
    rooms[roomId].viewers.forEach((viewerId) => {
      io.to(viewerId).emit('host-stopped-streaming');
    });
    emitRoomInfo(roomId);
  });

  socket.on('offer', ({ target, sdp }) => {
    if (!target || !sdp) {
      console.error('Invalid offer data');
      return;
    }
    io.to(target).emit('offer', { sdp, sender: socket.id });
  });

  socket.on('answer', ({ target, sdp }) => {
    if (!target || !sdp) {
      console.error('Invalid answer data');
      return;
    }
    io.to(target).emit('answer', { sdp, sender: socket.id });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    if (!target || !candidate) {
      console.error('Invalid ICE candidate data');
      return;
    }
    io.to(target).emit('ice-candidate', { candidate, sender: socket.id });
  });

  socket.on('send-message', (message) => {
    if (!message || typeof message !== 'string') {
      return;
    }
    const roomId = socketToRoom[socket.id];
    if (roomId && rooms[roomId]) {
      const newMessage = { sender: socket.id, message };
      rooms[roomId].messages.push(newMessage);
      io.to(roomId).emit('new-message', newMessage);
    }
  });

  socket.on('leave-room', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      leaveRoom(socket, roomId);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      leaveRoom(socket, roomId);
    }
  });

  function leaveRoom(socket, roomId) {
    if (!rooms[roomId]) return;

    const isHost = rooms[roomId].hostId === socket.id;

    if (isHost) {
      io.to(roomId).emit('host-left');
      rooms[roomId].viewers.forEach((viewerId) => {
        io.to(viewerId).emit('room-closed');
        delete socketToRoom[viewerId];
        io.sockets.sockets.get(viewerId)?.leave(roomId);
      });
      delete rooms[roomId];
    } else {
      rooms[roomId].viewers.delete(socket.id);
      delete rooms[roomId].users[socket.id];
      io.to(roomId).emit('user-left', socket.id);
    }

    delete socketToRoom[socket.id];
    socket.leave(roomId);
    emitRoomInfo(roomId);
  }

  function emitRoomInfo(roomId) {
    if (!rooms[roomId]) return;

    const info = {
      hostId: rooms[roomId].hostId,
      viewerCount: rooms[roomId].viewers.size,
      isHostActive: io.sockets.sockets.has(rooms[roomId].hostId),
      isHostStreaming: rooms[roomId].isStreaming,
      users: rooms[roomId].users,
    };

    io.to(roomId).emit('room-info', info);
  }
});

app.get('/Roomcount', (req, res) => {
  res.status(200).json({
    status: 'ok',
    activeRooms: Object.keys(rooms).length,
  });
});

app.get('/rooms', (req, res) => {
  const roomList = Object.keys(rooms).map((roomId) => ({
    roomId,
    viewerCount: rooms[roomId].viewers.size,
    isStreaming: rooms[roomId].isStreaming,
    hostId: rooms[roomId].hostId,
    users: rooms[roomId].users,
  }));

  res.status(200).json({
    status: 'ok',
    rooms: roomList,
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});