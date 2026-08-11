import { type FC, useEffect, useRef } from 'react';

type GridBackgroundProps = {
  gridSize?: number;
  meteorCount?: number;
};

enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3,
}

class Meteor {
  x = 0;
  y = 0;
  direction: Direction = Direction.UP;
  speed = 0;
  length = 0;
  opacity = 0;
  gridSize: number;
  canvas: HTMLCanvasElement;

  constructor(gridSize: number, canvas: HTMLCanvasElement) {
    this.gridSize = gridSize;
    this.canvas = canvas;
    this.reset();
  }

  reset() {
    this.direction = Math.floor(Math.random() * 4);
    this.speed = 2 + Math.random() * 3;
    this.length = this.gridSize * (1 + Math.random() * 2);
    this.opacity = 0.6 + Math.random() * 0.4;

    /**
     * Bias the perpendicular spawn coordinate toward the middle 60% of the
     * canvas edge (20% margin on each side). Without this, meteors that
     * spawn near a corner would only be visible for a few frames before
     * exiting an adjacent edge, looking like glitches rather than streaks.
     */
    const getMiddlePosition = (size: number) => {
      const margin = size * 0.2;
      return margin + Math.random() * (size * 0.6);
    };

    // Snap the perpendicular coordinate to the grid (Math.floor / gridSize)
    // so meteors travel along the visible grid lines drawn behind them.
    // Without snapping, meteors would streak between grid lines and lose the
    // intentional "tracing the grid" visual association.
    switch (this.direction) {
      case Direction.UP:
        this.x =
          Math.floor(getMiddlePosition(this.canvas.width) / this.gridSize) *
          this.gridSize;
        this.y = this.canvas.height;
        break;
      case Direction.RIGHT:
        this.x = 0;
        this.y =
          Math.floor(getMiddlePosition(this.canvas.height) / this.gridSize) *
          this.gridSize;
        break;
      case Direction.DOWN:
        this.x =
          Math.floor(getMiddlePosition(this.canvas.width) / this.gridSize) *
          this.gridSize;
        this.y = 0;
        break;
      case Direction.LEFT:
        this.x = this.canvas.width;
        this.y =
          Math.floor(getMiddlePosition(this.canvas.height) / this.gridSize) *
          this.gridSize;
        break;
    }
  }

  /**
   * Reset thresholds use `+ this.length` (vs just position) so the meteor
   * stays alive until its full tail has crossed off-screen. Otherwise the
   * tail would visibly snap-disappear the instant the head left the canvas.
   */
  update() {
    switch (this.direction) {
      case Direction.UP:
        this.y -= this.speed;
        if (this.y + this.length < 0) this.reset();
        break;
      case Direction.RIGHT:
        this.x += this.speed;
        if (this.x > this.canvas.width) this.reset();
        break;
      case Direction.DOWN:
        this.y += this.speed;
        if (this.y > this.canvas.height) this.reset();
        break;
      case Direction.LEFT:
        this.x -= this.speed;
        if (this.x + this.length < 0) this.reset();
        break;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const startX = this.x;
    const startY = this.y;
    let endX = this.x;
    let endY = this.y;

    switch (this.direction) {
      case Direction.UP:
        endY = this.y + this.length;
        break;
      case Direction.RIGHT:
        endX = this.x - this.length;
        break;
      case Direction.DOWN:
        endY = this.y - this.length;
        break;
      case Direction.LEFT:
        endX = this.x + this.length;
        break;
    }

    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    // Angular red head fading into Angular blue tail
    gradient.addColorStop(0, `rgba(221, 0, 49, ${this.opacity})`);
    gradient.addColorStop(0.02, `rgba(221, 0, 49, ${this.opacity * 0.8})`);
    gradient.addColorStop(0.05, `rgba(25, 118, 210, ${this.opacity * 0.6})`);
    gradient.addColorStop(1, `rgba(25, 118, 210, 0)`);

    ctx.beginPath();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
}

const MeteorsBackground: FC<GridBackgroundProps> = ({
  gridSize = 120,
  meteorCount = 5,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight * 0.65;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    const meteors = Array.from(
      { length: meteorCount },
      () => new Meteor(gridSize, canvas),
    );

    let rafId: number;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.lineWidth = 1;

      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      meteors.forEach((meteor) => {
        meteor.update();
        meteor.draw(ctx);
      });

      rafId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', setCanvasSize);
    };
  }, [gridSize, meteorCount]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '65vh',
        zIndex: -1,
      }}
    />
  );
};

export { MeteorsBackground };
