import { type FC, useRef, useEffect } from 'react';
import styles from './index.module.scss';

type BorderBeamProps = {
  size?: number;
  duration?: number;
  // Matches the host's corner radius, which clips the beam at the corners.
  radius?: number;
};

const BorderBeam: FC<BorderBeamProps> = ({
  size = 2,
  duration = 3,
  radius = 24,
}) => {
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
     * The beam's path: the host's outline, with its rounded corners, inset by
     * half the line width so the whole line lies inside the canvas (the
     * host's corner radius clips what doesn't). A point on it is named by its
     * distance along the path, clockwise from where the top edge begins:
     * each straight edge, then the quarter circle of the corner after it.
     * One number for a position means the beam's head and tail are just two
     * distances, whichever edge or corner they're on.
     */
    const tracePath = () => {
      const inset = size / 2;
      const w = canvas.width - size;
      const h = canvas.height - size;
      const r = Math.max(0, Math.min(radius - inset, w / 2, h / 2));
      const arc = (Math.PI / 2) * r;
      const edges = [w - 2 * r, h - 2 * r, w - 2 * r, h - 2 * r] as const;
      const perimeter = 2 * (edges[0] + edges[1]) + 4 * arc;
      // Where each edge starts and which way it runs, and the center of the
      // corner after it with the angle its arc starts at.
      const starts = [
        { x: inset + r, y: inset, dx: 1, dy: 0 },
        { x: inset + w, y: inset + r, dx: 0, dy: 1 },
        { x: inset + w - r, y: inset + h, dx: -1, dy: 0 },
        { x: inset, y: inset + h - r, dx: 0, dy: -1 },
      ] as const;
      const corners = [
        { x: inset + w - r, y: inset + r, from: -Math.PI / 2 },
        { x: inset + w - r, y: inset + h - r, from: 0 },
        { x: inset + r, y: inset + h - r, from: Math.PI / 2 },
        { x: inset + r, y: inset + r, from: Math.PI },
      ] as const;
      const pointAt = (distance: number) => {
        // Modulo so the beam wraps seamlessly past one full lap.
        let d = ((distance % perimeter) + perimeter) % perimeter;
        for (let i = 0; i < 4; i++) {
          if (d < edges[i]!) {
            const s = starts[i]!;
            return { x: s.x + s.dx * d, y: s.y + s.dy * d };
          }
          d -= edges[i]!;
          if (d < arc) {
            const c = corners[i]!;
            const angle = c.from + (r > 0 ? d / r : 0);
            return {
              x: c.x + r * Math.cos(angle),
              y: c.y + r * Math.sin(angle),
            };
          }
          d -= arc;
        }
        return { x: starts[0].x, y: starts[0].y };
      };
      return { perimeter, pointAt };
    };

    /**
     * Approximates the path between two distances as a polyline of 1px
     * segments, so the line bends around the corners' arcs rather than
     * cutting across them.
     */
    const drawPathSegment = (
      pointAt: (distance: number) => { x: number; y: number },
      start: number,
      end: number,
    ) => {
      let current = start;
      const currentPoint = pointAt(current);
      ctx.moveTo(currentPoint.x, currentPoint.y);
      while (current < end) {
        current += 1;
        const point = pointAt(current);
        ctx.lineTo(point.x, point.y);
      }
    };

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000;
      // progress wraps 0..1 across each `duration` interval — drives the
      // beam's position around the rectangle perimeter.
      const progress = (elapsed % duration) / duration;
      const { perimeter, pointAt } = tracePath();
      // Beam length is 5% of the perimeter — short enough to read as a
      // moving highlight rather than a solid border outline.
      const beamLength = perimeter * 0.05;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const positionStart = progress * perimeter;
      const positionEnd = (positionStart + beamLength) % perimeter;

      const startCoord = pointAt(positionStart);
      const endCoord = pointAt(positionEnd);
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
        drawPathSegment(pointAt, positionStart, perimeter);
        drawPathSegment(pointAt, 0, positionEnd);
      } else {
        drawPathSegment(pointAt, positionStart, positionEnd);
      }
      ctx.stroke();

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [size, duration, radius]);

  return (
    <div
      ref={containerRef}
      className={styles['border-beam-frame']}
      style={{ borderRadius: radius }}
    >
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
