import React, { useMemo } from 'react';
import { Cat } from 'lucide-react';

interface FloatingCatProps {
  id: number;
  top: string;
  left: string;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  rotation: number;
  color: string;
}

export const FloatingCatsBackground: React.FC = () => {
  // Generate a fixed set of floating background cats scattered naturally
  const cats: FloatingCatProps[] = useMemo(() => {
    const colors = [
      '#e07bb8', // vibrant sapphic pink
      '#a85293', // rich deep magenta/purple
      '#cbbccf', // soft lavender text highlight
      '#9333ea', // glowing violet
      '#fcf7fa', // gentle warm highlight
    ];

    return [
      { id: 1, top: '8%', left: '5%', size: 28, duration: 9, delay: 0, opacity: 0.22, rotation: -12, color: colors[0] },
      { id: 2, top: '15%', left: '88%', size: 34, duration: 12, delay: 1.5, opacity: 0.18, rotation: 15, color: colors[1] },
      { id: 3, top: '28%', left: '18%', size: 22, duration: 8, delay: 3, opacity: 0.15, rotation: 8, color: colors[2] },
      { id: 4, top: '42%', left: '92%', size: 40, duration: 14, delay: 0.8, opacity: 0.20, rotation: -8, color: colors[0] },
      { id: 5, top: '55%', left: '8%', size: 32, duration: 11, delay: 2.2, opacity: 0.17, rotation: 20, color: colors[3] },
      { id: 6, top: '68%', left: '82%', size: 26, duration: 9.5, delay: 4, opacity: 0.22, rotation: -15, color: colors[0] },
      { id: 7, top: '78%', left: '25%', size: 36, duration: 13, delay: 1.2, opacity: 0.19, rotation: 10, color: colors[1] },
      { id: 8, top: '86%', left: '72%', size: 30, duration: 10, delay: 2.8, opacity: 0.21, rotation: -6, color: colors[4] },
      { id: 9, top: '38%', left: '48%', size: 24, duration: 15, delay: 5, opacity: 0.12, rotation: 18, color: colors[2] },
      { id: 10, top: '92%', left: '12%', size: 28, duration: 8.5, delay: 0.3, opacity: 0.16, rotation: -10, color: colors[3] },
    ];
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
    >
      {cats.map((cat) => (
        <div
          key={cat.id}
          className="absolute transition-opacity duration-1000"
          style={{
            top: cat.top,
            left: cat.left,
            opacity: cat.opacity * 0.4,
            color: cat.color,
            animation: `floatCatDrift ${cat.duration}s ease-in-out infinite ${cat.delay}s`,
          }}
        >
          <Cat
            style={{
              width: `${cat.size}px`,
              height: `${cat.size}px`,
              transform: `rotate(${cat.rotation}deg)`,
            }}
            className="w-full h-full stroke-[1.5]"
          />
        </div>
      ))}
    </div>
  );
};
