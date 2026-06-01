/**
 * Native Canvas Confetti Engine
 * Zero dependencies, ultra-performance particle physics celebration
 */
export const ConfettiCelebrator = {
  launch() {
    // Avoid creating multiple canvas elements
    if (document.getElementById('confetti-canvas')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const colors = [
      '#FF3366', '#FF9933', '#FFFF33', '#33CC39', 
      '#3399FF', '#9933FF', '#FF33CC', '#00FFFF'
    ];
    const particleCount = 150;
    const particles = [];

    class ConfettiParticle {
      constructor() {
        this.x = Math.random() * width;
        // Start above viewport, spread them vertically for a continuous shower
        this.y = Math.random() * -height - 20;
        this.size = Math.random() * 8 + 6;
        this.color = colors[Math.floor(Math.random() * colors.length)];
        this.speedX = Math.random() * 4 - 2;
        this.speedY = Math.random() * 4 + 5; // Good falling velocity
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 6 - 3;
        this.opacity = 1;
        // Introduce small air oscillation (wobble)
        this.wobble = Math.random() * 10;
        this.wobbleSpeed = Math.random() * 0.05 + 0.02;
      }

      update() {
        this.wobble += this.wobbleSpeed;
        this.x += this.speedX + Math.sin(this.wobble) * 0.5;
        this.y += this.speedY;
        this.rotation += this.rotationSpeed;
        
        // Start fading out near the bottom
        if (this.y > height * 0.75) {
          this.opacity -= 0.025;
        }
      }

      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, this.opacity);
        ctx.fillStyle = this.color;
        
        // Draw a realistic confetti ribbon/rectangle
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6);
        ctx.restore();
      }
    }

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push(new ConfettiParticle());
    }

    let animationFrameId;
    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      let activeParticles = 0;
      particles.forEach(p => {
        if (p.opacity > 0 && p.y < height + p.size) {
          p.update();
          p.draw();
          activeParticles++;
        }
      });

      if (activeParticles > 0) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        cleanup();
      }
    };

    const cleanup = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      window.removeEventListener('resize', handleResize);
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };

    animate();
    
    // Safety auto-cleanup after 5 seconds to prevent leak
    setTimeout(cleanup, 5000);
  }
};
