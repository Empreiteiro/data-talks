import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  WalkthroughStep,
  WalkthroughState,
  WALKTHROUGH_STORAGE_KEY,
  defaultWalkthroughState,
} from '@/components/walkthrough/types';

interface WalkthroughContextType {
  isActive: boolean;
  currentStepIndex: number;
  currentStep: WalkthroughStep | null;
  steps: WalkthroughStep[];
  totalSteps: number;
  startTour: (pageId: string, steps: WalkthroughStep[]) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  finishTour: () => void;
  isPageCompleted: (pageId: string) => boolean;
  resetPage: (pageId: string) => void;
  resetAll: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextType | undefined>(undefined);

function loadState(): WalkthroughState {
  try {
    const raw = localStorage.getItem(WALKTHROUGH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse errors, return default
  }
  return { ...defaultWalkthroughState };
}

function saveState(state: WalkthroughState) {
  try {
    localStorage.setItem(WALKTHROUGH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export const WalkthroughProvider = ({ children }: { children: ReactNode }) => {
  const [persistedState, setPersistedState] = useState<WalkthroughState>(loadState);
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [steps, setSteps] = useState<WalkthroughStep[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const activeSteps = useRef<WalkthroughStep[]>([]);

  const updatePersistedState = useCallback((updater: (prev: WalkthroughState) => WalkthroughState) => {
    setPersistedState(prev => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  const resolveVisibleSteps = useCallback((allSteps: WalkthroughStep[]): WalkthroughStep[] => {
    return allSteps.filter(step => {
      const el = document.querySelector(`[data-walkthrough="${step.target}"]`);
      if (!el) return !step.optional ? false : false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }, []);

  const startTour = useCallback((pageId: string, tourSteps: WalkthroughStep[]) => {
    if (persistedState.globallySkipped) return;
    if (persistedState.completedPages[pageId]) return;
    if (isActive) return;

    const visible = resolveVisibleSteps(tourSteps);
    if (visible.length === 0) return;

    activeSteps.current = visible;
    setSteps(visible);
    setCurrentStepIndex(0);
    setActivePageId(pageId);
    setIsActive(true);
  }, [persistedState, isActive, resolveVisibleSteps]);

  const markPageComplete = useCallback((pageId: string) => {
    updatePersistedState(prev => ({
      ...prev,
      completedPages: { ...prev.completedPages, [pageId]: true },
    }));
  }, [updatePersistedState]);

  const finishTour = useCallback(() => {
    if (activePageId) markPageComplete(activePageId);
    setIsActive(false);
    setSteps([]);
    setCurrentStepIndex(0);
    setActivePageId(null);
  }, [activePageId, markPageComplete]);

  const skipTour = useCallback(() => {
    if (activePageId) markPageComplete(activePageId);
    updatePersistedState(prev => ({ ...prev, globallySkipped: true }));
    setIsActive(false);
    setSteps([]);
    setCurrentStepIndex(0);
    setActivePageId(null);
  }, [activePageId, markPageComplete, updatePersistedState]);

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      finishTour();
    }
  }, [currentStepIndex, steps.length, finishTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const isPageCompleted = useCallback((pageId: string) => {
    return persistedState.completedPages[pageId] === true || persistedState.globallySkipped;
  }, [persistedState]);

  const resetPage = useCallback((pageId: string) => {
    updatePersistedState(prev => {
      const next = { ...prev.completedPages };
      delete next[pageId];
      return { ...prev, completedPages: next };
    });
  }, [updatePersistedState]);

  const resetAll = useCallback(() => {
    updatePersistedState(() => ({ ...defaultWalkthroughState }));
  }, [updatePersistedState]);

  const currentStep = isActive && steps[currentStepIndex] ? steps[currentStepIndex] : null;

  return (
    <WalkthroughContext.Provider
      value={{
        isActive,
        currentStepIndex,
        currentStep,
        steps,
        totalSteps: steps.length,
        startTour,
        nextStep,
        prevStep,
        skipTour,
        finishTour,
        isPageCompleted,
        resetPage,
        resetAll,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
};

export function useWalkthrough() {
  const ctx = useContext(WalkthroughContext);
  if (!ctx) throw new Error('useWalkthrough must be used within WalkthroughProvider');
  return ctx;
}

export function usePageWalkthrough(pageId: string, tourSteps: WalkthroughStep[]) {
  const { startTour, isPageCompleted, isActive } = useWalkthrough();
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (hasTriggered.current) return;
    if (isPageCompleted(pageId)) return;
    if (isActive) return;

    hasTriggered.current = true;
    const timer = setTimeout(() => {
      startTour(pageId, tourSteps);
    }, 800);

    return () => clearTimeout(timer);
  }, [pageId, tourSteps, startTour, isPageCompleted, isActive]);
}
