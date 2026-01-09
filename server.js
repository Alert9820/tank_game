const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 1000,
  pingTimeout: 5000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

// Game Constants
const GAME_CONFIG = {
  ARENA_WIDTH: 1200,
  ARENA_HEIGHT: 700,
  TANK_WIDTH: 30,
  TANK_HEIGHT: 20,
  TANK_RADIUS: 15,
  BULLET_RADIUS: 5,
  BULLET_SPEED: 800,
  BULLET_DAMAGE: 25,
  MAX_HEALTH: 100,
  TANK_SPEED: 250,
  TANK_BOOST_MULTIPLIER: 1.8,
  FRICTION: 0.92,
  TANK_TURN_SPEED: 6, // Rotation speed for tank body
  TURRET_TURN_SPEED: 10, // Faster rotation for turret
  RESPAWN_TIME: 3000,
  BULLET_LIFETIME: 2000,
  REPAIR_AMOUNT: 10,
  REPAIR_COOLDOWN: 5000,
  SMOOTHING_FACTOR: 0.2,
  MAX_BULLETS: 50,
  UPDATE_RATE: 60,
  TANK_TURRET_OFFSET: 25 // Distance from tank center to turret tip
};

const players = {};
const bullets = new Map();
const lastRepairTime = {};
let bulletIdCounter = 0;

// Physics-based Player class
class Player {
  constructor(id, x, y) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0; // Tank body angle (based on movement)
    this.targetAngle = 0; // Target angle for tank body
    this.turretAngle = 0; // Turret angle (independent, for aiming)
    this.targetTurretAngle = 0; // Target turret angle (from mouse)
    this.hp = GAME_CONFIG.MAX_HEALTH;
    this.score = 0;
    this.name = `Player_${id.slice(0, 4)}`;
    this.isAlive = true;
    this.respawnTime = 0;
    this.lastShot = 0;
    this.shootCooldown = 300;
    this.lastUpdate = Date.now();
    
    // Input state
    this.inputState = {
      dx: 0,
      dy: 0,
      boost: false,
      mouseX: 0,
      mouseY: 0,
      isMouseDown: false
    };
  }

  update(deltaTime) {
    const now = Date.now();
    
    // Handle respawn
    if (!this.isAlive) {
      if (now > this.respawnTime) {
        this.respawn();
      }
      return;
    }

    // Apply input
    this.applyInput(deltaTime);

    // Apply friction
    this.vx *= Math.pow(GAME_CONFIG.FRICTION, deltaTime);
    this.vy *= Math.pow(GAME_CONFIG.FRICTION, deltaTime);

    // Update position
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;

    // Smooth tank body rotation (based on movement direction)
    let angleDiff = this.targetAngle - this.angle;
    angleDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    this.angle += angleDiff * GAME_CONFIG.SMOOTHING_FACTOR;

    // Smooth turret rotation (based on mouse aim)
    let turretAngleDiff = this.targetTurretAngle - this.turretAngle;
    turretAngleDiff = ((turretAngleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    this.turretAngle += turretAngleDiff * GAME_CONFIG.TURRET_TURN_SPEED * deltaTime;

    // Boundary collision with bounce
    if (this.x < GAME_CONFIG.TANK_RADIUS) {
      this.x = GAME_CONFIG.TANK_RADIUS;
      this.vx = Math.abs(this.vx) * 0.5;
    } else if (this.x > GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.TANK_RADIUS) {
      this.x = GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.TANK_RADIUS;
      this.vx = -Math.abs(this.vx) * 0.5;
    }
    
    if (this.y < GAME_CONFIG.TANK_RADIUS) {
      this.y = GAME_CONFIG.TANK_RADIUS;
      this.vy = Math.abs(this.vy) * 0.5;
    } else if (this.y > GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.TANK_RADIUS) {
      this.y = GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.TANK_RADIUS;
      this.vy = -Math.abs(this.vy) * 0.5;
    }

    this.lastUpdate = now;
  }

  applyInput(deltaTime) {
    if (!this.isAlive) return;

    const speed = GAME_CONFIG.TANK_SPEED * (this.inputState.boost ? GAME_CONFIG.TANK_BOOST_MULTIPLIER : 1);
    
    // Set velocity based on input (WASD or arrow keys)
    if (this.inputState.dx !== 0 || this.inputState.dy !== 0) {
      // Normalize diagonal movement
      const magnitude = Math.sqrt(this.inputState.dx * this.inputState.dx + this.inputState.dy * this.inputState.dy);
      const normalizedDx = this.inputState.dx / magnitude;
      const normalizedDy = this.inputState.dy / magnitude;
      
      this.vx = normalizedDx * speed;
      this.vy = normalizedDy * speed;
      
      // Update target tank angle based on movement direction
      this.targetAngle = Math.atan2(this.vy, this.vx);
    }
    
    // Update turret angle based on mouse position
    if (this.inputState.mouseX !== 0 || this.inputState.mouseY !== 0) {
      // Calculate angle from tank center to mouse position
      const dx = this.inputState.mouseX - this.x;
      const dy = this.inputState.mouseY - this.y;
      this.targetTurretAngle = Math.atan2(dy, dx);
    }
  }

  setInputState(input) {
    this.inputState = { ...this.inputState, ...input };
  }

  shoot() {
    if (!this.isAlive) return null;
    
    const now = Date.now();
    if (now - this.lastShot < this.shootCooldown) return null;
    
    this.lastShot = now;
    
    // Calculate bullet spawn position (from turret tip)
    const bulletX = this.x + Math.cos(this.turretAngle) * GAME_CONFIG.TANK_TURRET_OFFSET;
    const bulletY = this.y + Math.sin(this.turretAngle) * GAME_CONFIG.TANK_TURRET_OFFSET;
    
    const bulletId = `bullet_${bulletIdCounter++}`;
    
    return {
      id: bulletId,
      x: bulletX,
      y: bulletY,
      vx: Math.cos(this.turretAngle) * GAME_CONFIG.BULLET_SPEED,
      vy: Math.sin(this.turretAngle) * GAME_CONFIG.BULLET_SPEED,
      owner: this.id,
      createdAt: Date.now(),
      angle: this.turretAngle // Use turret angle for bullet direction
    };
  }

  takeDamage(damage, attackerId) {
    if (!this.isAlive) return false;
    
    this.hp -= damage;
    
    if (this.hp <= 0) {
      this.die();
      if (players[attackerId]) {
        players[attackerId].score += 100;
        io.to(attackerId).emit("kill", { victim: this.name });
      }
      return true;
    }
    return false;
  }

  die() {
    this.isAlive = false;
    this.hp = 0;
    this.respawnTime = Date.now() + GAME_CONFIG.RESPAWN_TIME;
    this.vx = 0;
    this.vy = 0;
    
    // Emit death to player
    io.to(this.id).emit("died");
  }

  respawn() {
    this.isAlive = true;
    this.hp = GAME_CONFIG.MAX_HEALTH;
    this.x = Math.random() * (GAME_CONFIG.ARENA_WIDTH - 200) + 100;
    this.y = Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 200) + 100;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.targetAngle = 0;
    this.turretAngle = 0;
    this.targetTurretAngle = 0;
    this.inputState = { dx: 0, dy: 0, boost: false, mouseX: 0, mouseY: 0, isMouseDown: false };
    
    io.to(this.id).emit("respawned");
  }

  repair() {
    if (!this.isAlive) return false;
    
    const now = Date.now();
    if (lastRepairTime[this.id] && now - lastRepairTime[this.id] < GAME_CONFIG.REPAIR_COOLDOWN) {
      return false;
    }
    
    lastRepairTime[this.id] = now;
    this.hp = Math.min(GAME_CONFIG.MAX_HEALTH, this.hp + GAME_CONFIG.REPAIR_AMOUNT);
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      angle: this.angle, // Tank body angle
      turretAngle: this.turretAngle, // Turret angle
      hp: this.hp,
      score: this.score,
      name: this.name,
      isAlive: this.isAlive,
      vx: this.vx,
      vy: this.vy
    };
  }
}

// Bullet class
class Bullet {
  constructor(data) {
    Object.assign(this, data);
    this.createdAt = Date.now();
  }

  update(deltaTime) {
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    
    // Check if out of bounds
    if (this.x < -100 || this.x > GAME_CONFIG.ARENA_WIDTH + 100 ||
        this.y < -100 || this.y > GAME_CONFIG.ARENA_HEIGHT + 100 ||
        Date.now() - this.createdAt > GAME_CONFIG.BULLET_LIFETIME) {
      return false;
    }
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      angle: this.angle,
      owner: this.owner
    };
  }
}

io.on("connection", (socket) => {
  console.log("Player joined:", socket.id);

  // Create new player in safe spawn location
  const spawnX = Math.random() * (GAME_CONFIG.ARENA_WIDTH - 200) + 100;
  const spawnY = Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 200) + 100;
  
  players[socket.id] = new Player(socket.id, spawnX, spawnY);

  // Send initial state to new player
  socket.emit("init", {
    myPlayerId: socket.id,
    config: GAME_CONFIG
  });

  // Send existing players to new player
  socket.emit("existingPlayers", {
    players: Object.fromEntries(
      Object.entries(players)
        .filter(([id]) => id !== socket.id)
        .map(([id, player]) => [id, player.toJSON()])
    ),
    bullets: Array.from(bullets.values()).map(bullet => bullet.toJSON())
  });

  // Notify other players about new player
  socket.broadcast.emit("playerJoined", {
    [socket.id]: players[socket.id].toJSON()
  });

  // Movement input (WASD or arrow keys)
  socket.on("move", (data) => {
    const player = players[socket.id];
    if (player) {
      player.setInputState(data);
    }
  });

  // Mouse movement for aiming
  socket.on("aim", (data) => {
    const player = players[socket.id];
    if (player) {
      player.setInputState({
        mouseX: data.x,
        mouseY: data.y
      });
    }
  });

  // Shooting (triggered by mouse click)
  socket.on("shoot", (data) => {
    const player = players[socket.id];
    if (player) {
      // Update mouse position from shot data for accurate aiming
      if (data && data.mouseX && data.mouseY) {
        player.setInputState({
          mouseX: data.mouseX,
          mouseY: data.mouseY
        });
      }
      
      const bulletData = player.shoot();
      if (bulletData) {
        const bullet = new Bullet(bulletData);
        bullets.set(bullet.id, bullet);
        
        // Play shoot sound to nearby players
        socket.broadcast.emit("shootSound", {
          x: bullet.x,
          y: bullet.y,
          playerId: socket.id
        });
      }
    }
  });

  // Mouse button state (for auto-fire if needed)
  socket.on("mouseDown", (data) => {
    const player = players[socket.id];
    if (player) {
      player.setInputState({
        isMouseDown: true,
        mouseX: data.x,
        mouseY: data.y
      });
    }
  });

  socket.on("mouseUp", () => {
    const player = players[socket.id];
    if (player) {
      player.setInputState({
        isMouseDown: false
      });
    }
  });

  // Repair
  socket.on("repair", () => {
    const player = players[socket.id];
    if (player && player.repair()) {
      socket.emit("repaired", { hp: player.hp });
    }
  });

  // Disconnection
  socket.on("disconnect", () => {
    console.log("Player left:", socket.id);
    const playerName = players[socket.id]?.name;
    delete players[socket.id];
    delete lastRepairTime[socket.id];
    
    // Notify other players
    io.emit("playerLeft", { playerId: socket.id, playerName });
  });
});

// Game loop
const TICK_RATE = 120;
const UPDATE_RATE = GAME_CONFIG.UPDATE_RATE;
const tickInterval = 1000 / TICK_RATE;
const updateInterval = 1000 / UPDATE_RATE;

let lastTick = Date.now();
let lastUpdateTime = Date.now();

function gameTick() {
  const now = Date.now();
  const deltaTime = (now - lastTick) / 1000;
  lastTick = now;

  // Limit deltaTime to prevent large jumps
  const clampedDeltaTime = Math.min(deltaTime, 0.1);

  // Update all players
  Object.values(players).forEach(player => {
    player.update(clampedDeltaTime);
  });

  // Update bullets and check collisions
  const bulletsToRemove = new Set();
  
  for (const [bulletId, bullet] of bullets) {
    // Update bullet position
    if (!bullet.update(clampedDeltaTime)) {
      bulletsToRemove.add(bulletId);
      continue;
    }

    // Check collision with players
    for (const playerId in players) {
      const player = players[playerId];
      
      if (player.isAlive && player.id !== bullet.owner) {
        const dx = bullet.x - player.x;
        const dy = bullet.y - player.y;
        const distanceSquared = dx * dx + dy * dy;
        const collisionDistance = GAME_CONFIG.TANK_RADIUS + GAME_CONFIG.BULLET_RADIUS;
        
        if (distanceSquared < collisionDistance * collisionDistance) {
          // Hit detected!
          const died = player.takeDamage(GAME_CONFIG.BULLET_DAMAGE, bullet.owner);
          
          // Mark bullet for removal
          bulletsToRemove.add(bulletId);
          
          // Emit hit effect to both players
          io.to(playerId).emit("hit", {
            damage: GAME_CONFIG.BULLET_DAMAGE,
            attacker: bullet.owner
          });
          
          if (died) {
            io.emit("playerDied", {
              playerId: playerId,
              killerId: bullet.owner
            });
          }
          break;
        }
      }
    }
  }

  // Remove marked bullets
  bulletsToRemove.forEach(bulletId => {
    bullets.delete(bulletId);
  });

  // Check tank-to-tank collisions
  const playerArray = Object.values(players).filter(p => p.isAlive);
  const collisionRadius = GAME_CONFIG.TANK_RADIUS * 2;
  
  for (let i = 0; i < playerArray.length; i++) {
    const p1 = playerArray[i];
    
    for (let j = i + 1; j < playerArray.length; j++) {
      const p2 = playerArray[j];
      
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const distanceSquared = dx * dx + dy * dy;
      
      if (distanceSquared < collisionRadius * collisionRadius) {
        const distance = Math.sqrt(distanceSquared);
        const minDistance = GAME_CONFIG.TANK_RADIUS * 2;
        
        if (distance < minDistance && distance > 0) {
          const nx = dx / distance;
          const ny = dy / distance;
          const overlap = (minDistance - distance) / 2;
          
          p1.x += nx * overlap;
          p1.y += ny * overlap;
          p2.x -= nx * overlap;
          p2.y -= ny * overlap;
          
          const damping = 0.8;
          p1.vx += nx * overlap * damping;
          p1.vy += ny * overlap * damping;
          p2.vx -= nx * overlap * damping;
          p2.vy -= ny * overlap * damping;
        }
      }
    }
  }

  // Limit number of bullets
  if (bullets.size > GAME_CONFIG.MAX_BULLETS) {
    const oldestBullets = Array.from(bullets.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, bullets.size - GAME_CONFIG.MAX_BULLETS);
    
    oldestBullets.forEach(([id]) => bullets.delete(id));
  }
}

function sendUpdates() {
  const now = Date.now();
  
  const gameState = {
    players: Object.fromEntries(
      Object.entries(players).map(([id, player]) => [id, player.toJSON()])
    ),
    bullets: Array.from(bullets.values()).map(bullet => bullet.toJSON()),
    timestamp: now
  };

  io.emit("state", gameState);
  
  lastUpdateTime = now;
}

// Start game tick loop
setInterval(gameTick, tickInterval);

// Start update loop
setInterval(sendUpdates, updateInterval);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Arena size: ${GAME_CONFIG.ARENA_WIDTH}x${GAME_CONFIG.ARENA_HEIGHT}`);
  console.log(`Tick rate: ${TICK_RATE}Hz, Update rate: ${UPDATE_RATE}Hz`);
  console.log(`Controls: WASD/Arrow Keys to move, Mouse to aim, Click to shoot`);
});
