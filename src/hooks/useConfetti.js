import { useCallback } from 'react';
import confetti from 'canvas-confetti';

export const useConfetti = () => {
  // 기본 폭죽 (클릭 지점 또는 중앙에서 발생)
  const fire = useCallback((options) => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      ...options,
    });
  }, []);
  
  // 축하용 폭죽 (화면 좌우 아래에서 연달아 터지는 효과)
  const firePride = useCallback(() => {
    const end = Date.now() + 2 * 1000; // 2초간 지속
    const colors = ['#bb0000', '#ffffff'];
    
    (function frame() {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors,
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors,
      });
      
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  }, []);
  
  // 화면 전체 폭죽
  const fireFireworks = useCallback(() => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };
    
    function randomInRange(min, max) {
      return Math.random() * (max - min) + min;
    }
    
    const interval = setInterval(function () {
      const timeLeft = animationEnd - Date.now();
      
      if (timeLeft <= 0) {
        return clearInterval(interval);
      }
      
      const particleCount = 50 * (timeLeft / duration);
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  }, []);
  
  return { fire, firePride, fireFireworks };
};