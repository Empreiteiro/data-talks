import { useLanguage } from '@/contexts/LanguageContext';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WalkthroughTooltip } from './WalkthroughTooltip';

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 8;
const TOOLTIP_GAP = 16;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getArrowDirection(position: 'top' | 'bottom' | 'left' | 'right') {
  const map = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  return map[position];
}

export function WalkthroughOverlay() {
  const { isActive, currentStep, currentStepIndex, totalSteps, nextStep, prevStep, skipTour } = useWalkthrough();
  const { t } = useLanguage();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const computePosition = useCallback(() => {
    if (!currentStep) return;

    const el = document.querySelector(`[data-walkthrough="${currentStep.target}"]`);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;

    const padded: Rect = {
      top: rect.top + scrollTop - SPOTLIGHT_PADDING,
      left: rect.left + scrollLeft - SPOTLIGHT_PADDING,
      width: rect.width + SPOTLIGHT_PADDING * 2,
      height: rect.height + SPOTLIGHT_PADDING * 2,
    };

    setTargetRect(padded);

    const tooltipW = 340;
    const tooltipH = tooltipRef.current?.offsetHeight || 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    const centerX = padded.left + padded.width / 2;
    const centerY = padded.top + padded.height / 2;

    switch (currentStep.position) {
      case 'bottom':
        top = padded.top + padded.height + TOOLTIP_GAP;
        left = centerX - tooltipW / 2;
        break;
      case 'top':
        top = padded.top - tooltipH - TOOLTIP_GAP;
        left = centerX - tooltipW / 2;
        break;
      case 'right':
        top = centerY - tooltipH / 2;
        left = padded.left + padded.width + TOOLTIP_GAP;
        break;
      case 'left':
        top = centerY - tooltipH / 2;
        left = padded.left - tooltipW - TOOLTIP_GAP;
        break;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, vw - tooltipW - 12 + scrollLeft));
    top = Math.max(12 + scrollTop, Math.min(top, vh - tooltipH - 12 + scrollTop));

    setTooltipPos({ top, left });
  }, [currentStep]);

  // Scroll target into view and compute position
  useEffect(() => {
    if (!isActive || !currentStep) {
      setVisible(false);
      return;
    }

    const el = document.querySelector(`[data-walkthrough="${currentStep.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Small delay after scroll to compute position
    const timer = setTimeout(() => {
      computePosition();
      setVisible(true);
    }, 350);

    return () => clearTimeout(timer);
  }, [isActive, currentStep, computePosition]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isActive) return;

    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(computePosition);
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);
    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, computePosition]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { skipTour(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') { nextStep(); return; }
      if (e.key === 'ArrowLeft') { prevStep(); return; }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, nextStep, prevStep, skipTour]);

  if (!isActive || !currentStep || !targetRect) return null;

  const arrowDir = getArrowDirection(currentStep.position);

  return createPortal(
    <div
      className="fixed inset-0 z-[9998]"
      style={{ pointerEvents: 'none' }}
    >
      {/* Spotlight overlay */}
      <div
        className="absolute transition-all duration-300 ease-in-out"
        style={{
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
          borderRadius: SPOTLIGHT_RADIUS,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          pointerEvents: 'none',
          opacity: visible ? 1 : 0,
        }}
      />

      {/* Click blocker (everywhere except spotlight) */}
      <div
        className="fixed inset-0"
        style={{
          pointerEvents: 'auto',
          background: 'transparent',
          clipPath: `polygon(
            0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
            ${targetRect.left}px ${targetRect.top}px,
            ${targetRect.left}px ${targetRect.top + targetRect.height}px,
            ${targetRect.left + targetRect.width}px ${targetRect.top + targetRect.height}px,
            ${targetRect.left + targetRect.width}px ${targetRect.top}px,
            ${targetRect.left}px ${targetRect.top}px
          )`,
        }}
        onClick={skipTour}
      />

      {/* Pulsing ring around spotlight */}
      <div
        className="absolute border-2 border-emerald-400 transition-all duration-300 ease-in-out"
        style={{
          top: targetRect.top - 2,
          left: targetRect.left - 2,
          width: targetRect.width + 4,
          height: targetRect.height + 4,
          borderRadius: SPOTLIGHT_RADIUS + 2,
          pointerEvents: 'none',
          opacity: visible ? 1 : 0,
          animation: 'walkthrough-pulse 2s ease-in-out infinite',
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute z-[9999] transition-all duration-300 ease-in-out"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          pointerEvents: 'auto',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(8px)',
        }}
      >
        <WalkthroughTooltip
          title={t(currentStep.titleKey)}
          description={t(currentStep.descriptionKey)}
          currentStep={currentStepIndex}
          totalSteps={totalSteps}
          arrowDirection={arrowDir}
          onNext={nextStep}
          onPrev={prevStep}
          onSkip={skipTour}
        />
      </div>

      {/* Global styles for pulse animation */}
      <style>{`
        @keyframes walkthrough-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.01); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
