import { cn } from '@/lib/utils';

interface WalkthroughArrowProps {
  direction: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function WalkthroughArrow({ direction, className }: WalkthroughArrowProps) {
  return (
    <div
      className={cn(
        'absolute w-0 h-0',
        direction === 'top' && 'border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[10px] border-b-white -top-[10px] left-1/2 -translate-x-1/2',
        direction === 'bottom' && 'border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-white -bottom-[10px] left-1/2 -translate-x-1/2',
        direction === 'left' && 'border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-r-[10px] border-r-white -left-[10px] top-1/2 -translate-y-1/2',
        direction === 'right' && 'border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-l-[10px] border-l-white -right-[10px] top-1/2 -translate-y-1/2',
        className,
      )}
    />
  );
}
