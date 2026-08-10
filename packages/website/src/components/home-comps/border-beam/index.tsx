import { type FC, useRef, useEffect } from 'react';
import styles from './index.module.scss';

type BorderBeamProps = {
  size?: number;
  duration?: number;
};

const BorderBeam: FC<BorderBeamProps> = ({ size = 2, duration = 3 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
    });
    resizeObserver.observe(container);

    const { width: initW, height: initH } = container.getBoundingClientRect();
    canvas.width = initW;
    canvas.height = initH;

    let animationFrameId: number;
    const startTime = performance.now();

    /**
     * Maps a scalar distance (0 → perimeter) to (x, y) coordinates by walking
     * the rectangle's edges clockwise starting from the top-left corner:
     *   - [0, width)               → top edge (x increases, y=0)
     *   - [width, width+height)    → right edge (x=width, y increases)
     *   - [width+height, 2w+h)     → bottom edge (x decreases, y=height)
     *   - [2w+h, 2(w+h))           → left edge (x=0, y decreases)
     * This lets us parameterize the moving beam by a single number (its
     * distance along the perimeter) instead of tracking which edge it's on
     * and the offset within that edge separately.
     */
    const getCoordinatesFromDistance = (distance: number) => {
      const width = canvas.width;
      const height = canvas.height;
      const perimeter = 2 * (width + height);
      // Modulo so the beam wraps seamlessly when `distance` exceeds one full lap.
      distance = distance % perimeter;

      if (distance < width) return { x: distance, y: 0 };
      if (distance < width + height) return { x: width, y: distance - width };
      if (distance < 2 * width + height)
        return { x: width - (distance - (width + height)), y: height };
      return { x: 0, y: height - (distance - (2 * width + height)) };
    };

    /**
     * Approximates the path between two perimeter distances as a polyline of
     * 1px segments. We sample every pixel rather than drawing exact corner
     * arcs because the beam needs to bend cleanly around the rectangle's
     * corners — a direct moveTo/lineTo across a corner would cut diagonally
     * instead of following the rectangle's outline.
     */
    const drawPathSegment = (start: number, end: number) => {
      let current = start;
      const currentPoint = getCoordinatesFromDistance(current);
      ctx.moveTo(currentPoint.x, currentPoint.y);
      while (current < end) {
        current += 1;
        const point = getCoordinatesFromDistance(current);
        ctx.lineTo(point.x, point.y);
      }
    };

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000;
      // progress wraps 0..1 across each `duration` interval — drives the
      // beam's position around the rectangle perimeter.
      const progress = (elapsed % duration) / duration;
      const width = canvas.width;
      const height = canvas.height;
      const perimeter = 2 * (width + height);
      // Beam length is 5% of the perimeter — short enough to read as a
      // moving highlight rather than a solid border outline.
      const beamLength = perimeter * 0.05;

      ctx.clearRect(0, 0, width, height);

      const positionStart = progress * perimeter;
      const positionEnd = (positionStart + beamLength) % perimeter;

      const startCoord = getCoordinatesFromDistance(positionStart);
      const endCoord = getCoordinatesFromDistance(positionEnd);
      const gradient = ctx.createLinearGradient(
        startCoord.x,
        startCoord.y,
        endCoord.x,
        endCoord.y,
      );

      // Color stops fade transparent → red → blue → transparent so the beam
      // has soft edges and a brand-colored core. The red→blue transition
      // happens late (0.8 → 0.9) so the bulk of the beam reads as red and
      // the trailing edge picks up the Angular blue accent.
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.2, 'rgba(221, 0, 49, 0.3)');
      gradient.addColorStop(0.5, '#dd0031');
      gradient.addColorStop(0.8, '#dd0031');
      gradient.addColorStop(0.9, '#1976d2');
      gradient.addColorStop(1, 'transparent');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = size;
      ctx.beginPath();

      // When the beam straddles the perimeter wraparound (end < start), draw
      // two segments: [start, perimeter] then [0, end]. A single segment
      // would dip through the rectangle interior to reach the lower distance,
      // producing a visible diagonal slash across the box.
      if (positionEnd < positionStart) {
        drawPathSegment(positionStart, perimeter);
        drawPathSegment(0, positionEnd);
      } else {
        drawPathSegment(positionStart, positionEnd);
      }
      ctx.stroke();

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [size, duration]);

  return (
    <div ref={containerRef} className={styles['border-beam-frame']}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export { BorderBeam };
