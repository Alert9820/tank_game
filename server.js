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
  BULLET_RADIUS: 5, // Reduced for better hit detection
  BULLET_SPEED: 800, // Increased for smoother movement (pixels per second)
  BULLET_DAMAGE: 25,
  MAX_HEALTH: 100,
  TANK_SPEED: 250, // Changed to pixels per second
  TANK_BOOST_MULTIPLIER: 1.8,
  FRICTION: 0.92,
  ROTATION_SPEED: 8, // Increased for faster response
  RESPAWN_TIME: 3000,
  BULLET_LIFETIME: 2000,
  REPAIR_AMOUNT: 10,
  REPAIR_COOLDOWN: 5000,
  SMOOTHING_FACTOR: 0.2, // For rotation smoothing
  MAX_BULLETS: 50, // Prevent memory leaks
  UPDATE_RATE: 60 // FPS for client updates
};

const players = {};
const bullets = new Map(); // Use Map for better bullet management
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
    this.angle = 0;
    this.targetAngle = 0;
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
      angle: 0
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

    // Smooth rotation using lerp
    let angleDiff = this.targetAngle - this.angle;
    // Normalize angle difference
    angleDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    
    this.angle += angleDiff * GAME_CONFIG.SMOOTHING_FACTOR;

    // Boundary collision with bounce
    if (this.x < GAME_CONFIG.TANK_RADIUS) {
      this.x = GAME_CONFIG.TANK_RADIUS;
      this.vx = Math.abs(this.vx) * 0.5; // Bounce
    } else if (this.x > GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.TANK_RADIUS) {
      this.x = GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.TANK_RADIUS;
      this.vx = -Math.abs(this.vx) * 0.5; // Bounce
    }
    
    if (this.y < GAME_CONFIG.TANK_RADIUS) {
      this.y = GAME_CONFIG.TANK_RADIUS;
      this.vy = Math.abs(this.vy) * 0.5; // Bounce
    } else if (this.y > GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.TANK_RADIUS) {
      this.y = GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.TANK_RADIUS;
      this.vy = -Math.abs(this.vy) * 0.5; // Bounce
    }

    this.lastUpdate = now;
  }

  applyInput(deltaTime) {
    if (!this.isAlive) return;

    const speed = GAME_CONFIG.TANK_SPEED * (this.inputState.boost ? GAME_CONFIG.TANK_BOOST_MULTIPLIER : 1);
    
    // Set velocity based on input (normalized for diagonal movement)
    if (this.inputState.dx !== 0 || this.inputState.dy !== 0) {
      // Normalize diagonal movement
      const magnitude = Math.sqrt(this.inputState.dx * this.inputState.dx + this.inputState.dy * this.inputState.dy);
      const normalizedDx = this.inputState.dx / magnitude;
      const normalizedDy = this.inputState.dy / magnitude;
      
      this.vx = normalizedDx * speed;
      this.vy = normalizedDy * speed;
      
      // Update target angle based on movement direction
      this.targetAngle = Math.atan2(this.vy, this.vx);
    }
    
    // Also allow rotation without movement
    if (this.inputState.angle !== 0) {
      this.targetAngle += this.inputState.angle * GAME_CONFIG.ROTATION_SPEED * deltaTime;
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
    
    // Calculate bullet spawn position (from cannon tip)
    const cannonLength = 25;
    const bulletX = this.x + Math.cos(this.angle) * cannonLength;
    const bulletY = this.y + Math.sin(this.angle) * cannonLength;
    
    const bulletId = `bullet_${bulletIdCounter++}`;
    
    return {
      id: bulletId,
      x: bulletX,
      y: bulletY,
      vx: Math.cos(this.angle) * GAME_CONFIG.BULLET_SPEED,
      vy: Math.sin(this.angle) * GAME_CONFIG.BULLET_SPEED,
      owner: this.id,
      createdAt: Date.now(),
      angle: this.angle
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
    this.inputState = { dx: 0, dy: 0, boost: false, angle: 0 };
    
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
      angle: this.angle,
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

  // Movement input - use object for smoother updates
  socket.on("move", (data) => {
    const player = players[socket.id];
    if (player) {
      player.setInputState(data);
    }
  });

  // Shooting
  socket.on("shoot", () => {
    const player = players[socket.id];
    if (player) {
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
const TICK_RATE = 120; // High tick rate for smooth physics
const UPDATE_RATE = GAME_CONFIG.UPDATE_RATE; // Lower rate for network updates
const tickInterval = 1000 / TICK_RATE;
const updateInterval = 1000 / UPDATE_RATE;

let lastTick = Date.now();
let lastUpdateTime = Date.now();

function gameTick() {
  const now = Date.now();
  const deltaTime = (now - lastTick) / 1000; // Convert to seconds
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
          break; // This bullet can only hit one player per frame
        }
      }
    }
  }

  // Remove marked bullets
  bulletsToRemove.forEach(bulletId => {
    bullets.delete(bulletId);
  });

  // Check tank-to-tank collisions (optimized)
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
          // Normalize collision vector
          const nx = dx / distance;
          const ny = dy / distance;
          
          // Calculate overlap
          const overlap = (minDistance - distance) / 2;
          
          // Separate tanks
          p1.x += nx * overlap;
          p1.y += ny * overlap;
          p2.x -= nx * overlap;
          p2.y -= ny * overlap;
          
          // Elastic collision response (simplified)
          const damping = 0.8;
          p1.vx += nx * overlap * damping;
          p1.vy += ny * overlap * damping;
          p2.vx -= nx * overlap * damping;
          p2.vy -= ny * overlap * damping;
        }
      }
    }
  }

  // Limit number of bullets to prevent memory leaks
  if (bullets.size > GAME_CONFIG.MAX_BULLETS) {
    const oldestBullets = Array.from(bullets.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, bullets.size - GAME_CONFIG.MAX_BULLETS);
    
    oldestBullets.forEach(([id]) => bullets.delete(id));
  }
}

// Separate update loop for network optimization
function sendUpdates() {
  const now = Date.now();
  
  // Prepare game state
  const gameState = {
    players: Object.fromEntries(
      Object.entries(players).map(([id, player]) => [id, player.toJSON()])
    ),
    bullets: Array.from(bullets.values()).map(bullet => bullet.toJSON()),
    timestamp: now
  };

  // Send to all players
  io.emit("state", gameState);
  
  lastUpdateTime = now;
}

// Start game tick loop (high frequency for physics)
setInterval(gameTick, tickInterval);

// Start update loop (lower frequency for network)
setInterval(sendUpdates, updateInterval);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Arena size: ${GAME_CONFIG.ARENA_WIDTH}x${GAME_CONFIG.ARENA_HEIGHT}`);
  console.log(`Tick rate: ${TICK_RATE}Hz, Update rate: ${UPDATE_RATE}Hz`);
});
