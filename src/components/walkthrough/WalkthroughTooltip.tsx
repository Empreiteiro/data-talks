import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { WalkthroughArrow } from './WalkthroughArrow';

interface WalkthroughTooltipProps {
  title: string;
  description: string;
  currentStep: number;
  totalSteps: number;
  arrowDirection: 'top' | 'bottom' | 'left' | 'right';
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function WalkthroughTooltip({
  title,
  description,
  currentStep,
  totalSteps,
  arrowDirection,
  onNext,
  onPrev,
  onSkip,
  className,
  style,
}: WalkthroughTooltipProps) {
  const { t } = useLanguage();
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  return (
    <div
      className={cn(
        'relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700',
        'w-[340px] max-w-[90vw] animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
        className,
      )}
      style={style}
    >
      <WalkthroughArrow direction={arrowDirection} />

      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
            {currentStep + 1}
          </div>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
            {t('walkthrough.stepOf')
              .replace('{current}', String(currentStep + 1))
              .replace('{total}', String(totalSteps))}
          </span>
        </div>
        <button
          onClick={onSkip}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-0.5 rounded"
          aria-label={t('walkthrough.skip')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="px-5 pb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {title}
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {description}
        </p>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 pb-3">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'rounded-full transition-all duration-300',
              i === currentStep
                ? 'w-5 h-2 bg-emerald-500'
                : i < currentStep
                  ? 'w-2 h-2 bg-emerald-300 dark:bg-emerald-700'
                  : 'w-2 h-2 bg-zinc-200 dark:bg-zinc-700',
            )}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-5 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 text-xs"
        >
          {t('walkthrough.skip')}
        </Button>
        <div className="flex items-center gap-2">
          {!isFirst && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              className="h-8 px-3 text-xs"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              {t('walkthrough.prev')}
            </Button>
          )}
          <Button
            size="sm"
            onClick={onNext}
            className="h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isLast ? t('walkthrough.finish') : t('walkthrough.next')}
            {!isLast && <ChevronRight className="w-3.5 h-3.5 ml-1" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
