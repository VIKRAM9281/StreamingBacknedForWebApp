const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = {}; // { roomId: { host: socketId, viewers: [], streamers: [] } }
app.get((req,res)=>{
  res.send("Hello")
})
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, role }) => {
    socket.join(roomId);
    console.log(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { host: null, viewers: [], streamers: [] };
    }

    if (role === 'host') rooms[roomId].host = socket.id;
    else rooms[roomId].viewers.push(socket.id);

    io.to(roomId).emit('user-joined', { id: socket.id, role });
  });

  socket.on('request-stream', ({ roomId }) => {
    console.log('requested ',socket.id);
    const hostId = rooms[roomId]?.host;
    if (hostId) io.to(hostId).emit('stream-request', { id: socket.id });
  });

  socket.on('approve-stream', ({ roomId, toUserId }) => {
    if (rooms[roomId]) rooms[roomId].streamers.push(toUserId);
    io.to(toUserId).emit('stream-approved');
  });

  socket.on('signal', ({ roomId, to, from, data }) => {
    console.log(data);
    io.to(to).emit('signal', { from, data });
  });

  socket.on('disconnecting', () => {
    console.log('disconnected');
    for (const roomId of socket.rooms) {
      const room = rooms[roomId];
      if (!room) continue;
      room.viewers = room.viewers.filter((id) => id !== socket.id);
      room.streamers = room.streamers.filter((id) => id !== socket.id);
      if (room.host === socket.id) room.host = null;
      io.to(roomId).emit('user-left', { id: socket.id });
    }
  });
});

server.listen(5000, () => console.log('Server running on port http://192.168.63.113:5000'));
