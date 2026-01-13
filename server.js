// Add near the top with other variables....
let obstacles = [];

// Add to socket.on("init") handler
socket.on("init", (data) => {
  myPlayerId = data.myPlayerId;
  obstacles = data.obstacles || [];
  console.log("Game initialized, my ID:", myPlayerId);
  // Initialize camera to player position
  if (players[myPlayerId]) {
    camera.x = players[myPlayerId].x;
    camera.y = players[myPlayerId].y;
  }
});

// Add to socket.on("state") handler
socket.on("state", (data) => {
  players = data.players;
  bullets = data.bullets;
  obstacles = data.obstacles || [];
  // ... rest of your code
});

// Add this function to draw obstacles
function drawObstacles() {
  obstacles.forEach(obstacle => {
    const screenPos = worldToScreen(obstacle.x, obstacle.y);
    const screenWidth = (obstacle.width / ARENA_WIDTH) * (canvas.width * (ARENA_WIDTH / canvas.width));
    const screenHeight = (obstacle.height / ARENA_HEIGHT) * (canvas.height * (ARENA_HEIGHT / canvas.height));
    
    ctx.save();
    
    if (obstacle.type === 'rock') {
      // Draw rock obstacle
      ctx.fillStyle = '#555';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      
      // Create rocky shape
      ctx.beginPath();
      ctx.roundRect(screenPos.x, screenPos.y, screenWidth, screenHeight, 10);
      ctx.fill();
      ctx.stroke();
      
      // Rock texture
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let i = 0; i < 5; i++) {
        const x = screenPos.x + Math.random() * screenWidth;
        const y = screenPos.y + Math.random() * screenHeight;
        const size = Math.random() * 5 + 3;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Draw wall obstacle
      const wallGradient = ctx.createLinearGradient(
        screenPos.x, screenPos.y,
        screenPos.x + screenWidth, screenPos.y + screenHeight
      );
      wallGradient.addColorStop(0, '#666');
      wallGradient.addColorStop(1, '#444');
      
      ctx.fillStyle = wallGradient;
      ctx.fillRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
      
      // Wall border
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
      
      // Wall texture (bricks)
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      
      // Horizontal lines
      for (let y = screenPos.y + 15; y < screenPos.y + screenHeight; y += 15) {
        ctx.beginPath();
        ctx.moveTo(screenPos.x, y);
        ctx.lineTo(screenPos.x + screenWidth, y);
        ctx.stroke();
      }
      
      // Vertical lines (staggered for brick pattern)
      for (let x = screenPos.x + 25; x < screenPos.x + screenWidth; x += 25) {
        ctx.beginPath();
        const startY = Math.floor((x - screenPos.x) / 25) % 2 === 0 ? screenPos.y : screenPos.y + 7.5;
        for (let y = startY; y < screenPos.y + screenHeight; y += 30) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, Math.min(y + 15, screenPos.y + screenHeight));
        }
        ctx.stroke();
      }
    }
    
    ctx.restore();
  });
}

// Add to your draw() function, before drawing players and bullets:
function draw() {
  // Clear canvas...
  drawArenaBoundaries();
  drawObstacles(); // Add this line
  // Draw ground pattern...
  // Draw bullets...
  // Draw players...
}

// Add to drawMinimap() function:
function drawMinimap() {
  minimapCtx.clearRect(0, 0, 130, 130);
  
  // Draw minimap background
  minimapCtx.fillStyle = "rgba(20,20,40,0.8)";
  minimapCtx.fillRect(0, 0, 130, 130);
  
  // Draw obstacles on minimap
  obstacles.forEach(obstacle => {
    const miniX = (obstacle.x / ARENA_WIDTH) * 120 + 5;
    const miniY = (obstacle.y / ARENA_HEIGHT) * 120 + 5;
    const miniWidth = (obstacle.width / ARENA_WIDTH) * 120;
    const miniHeight = (obstacle.height / ARENA_HEIGHT) * 120;
    
    minimapCtx.fillStyle = obstacle.type === 'rock' ? '#555' : '#666';
    if (obstacle.type === 'rock') {
      minimapCtx.beginPath();
      minimapCtx.roundRect(miniX, miniY, miniWidth, miniHeight, 2);
      minimapCtx.fill();
    } else {
      minimapCtx.fillRect(miniX, miniY, miniWidth, miniHeight);
    }
  });
  
  // Draw arena boundaries...
  // Draw camera viewport...
  // Draw players...
  // Draw bullets...
}
