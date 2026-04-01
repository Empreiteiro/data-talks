export interface WalkthroughStep {
  id: string;
  target: string;
  titleKey: string;
  descriptionKey: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  optional?: boolean;
}

export interface WalkthroughState {
  completedPages: Record<string, boolean>;
  globallySkipped: boolean;
}

export const WALKTHROUGH_STORAGE_KEY = 'dt_walkthrough';

export const defaultWalkthroughState: WalkthroughState = {
  completedPages: {},
  globallySkipped: false,
};
