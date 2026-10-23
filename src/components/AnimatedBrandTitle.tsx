import React, { useState, useEffect } from 'react';

interface AnimatedBrandTitleProps {
  className?: string;
  sizeClass?: string;
}

export const AnimatedBrandTitle: React.FC<AnimatedBrandTitleProps> = ({
  className = '',
  sizeClass = 'text-xl',
}) => {
  const [displayText, setDisplayText] = useState('QUEERSPACE');
  const [targetWord, setTargetWord] = useState('QUEERSPACE');

  // Trigger letter morphing whenever targetWord changes
  useEffect(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let iteration = 0;
    let timer: NodeJS.Timeout;

    const scramble = () => {
      iteration += 0.4;

      const newText = targetWord
        .split('')
        .map((char, index) => {
          if (index < iteration) {
            return targetWord[index];
          }
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join('');

      setDisplayText(newText);

      if (iteration < targetWord.length) {
        timer = setTimeout(scramble, 30);
      } else {
        setDisplayText(targetWord);
      }
    };

    scramble();

    return () => clearTimeout(timer);
  }, [targetWord]);

  // Auto loop: QUEERSPACE -> QUEERSCAPE -> QUEERSPACE every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTargetWord((current) =>
        current === 'QUEERSPACE' ? 'QUEERSCAPE' : 'QUEERSPACE'
      );
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleManualTrigger = () => {
    setTargetWord((current) =>
      current === 'QUEERSPACE' ? 'QUEERSCAPE' : 'QUEERSPACE'
    );
  };

  return (
    <span
      onClick={handleManualTrigger}
      onMouseEnter={handleManualTrigger}
      className={`font-serif font-bold tracking-tight text-[#fcf7fa] select-none transition-colors hover:text-[#e07bb8] cursor-pointer inline-block ${sizeClass} ${className}`}
      title="Click or hover to jumble QUEERSPACE <-> QUEERSCAPE"
    >
      {displayText}
    </span>
  );
};
