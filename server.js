const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {};
const bullets = [];

io.on("connection", (socket) => {
  console.log("Player joined:", socket.id);

  players[socket.id] = {
    id: socket.id,
    x: Math.random() * 700 + 50,
    y: Math.random() * 400 + 50,
    angle: 0,
    hp: 100
  };

  socket.on("move", (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x += data.dx;
    p.y += data.dy;
    p.angle = data.angle;
  });

  socket.on("shoot", () => {
    const p = players[socket.id];
    if (!p) return;
    bullets.push({
      x: p.x,
      y: p.y,
      angle: p.angle,
      owner: socket.id
    });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
  });
});

setInterval(() => {
  bullets.forEach((b, i) => {
    b.x += Math.cos(b.angle) * 6;
    b.y += Math.sin(b.angle) * 6;

    Object.values(players).forEach((p) => {
      if (p.id !== b.owner) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        if (Math.sqrt(dx * dx + dy * dy) < 18) {
          p.hp -= 20;
          bullets.splice(i, 1);
        }
      }
    });
  });

  io.emit("state", { players, bullets });
}, 1000 / 30);

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
