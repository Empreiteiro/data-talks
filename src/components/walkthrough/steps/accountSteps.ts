import { WalkthroughStep } from '../types';

export const accountSteps: WalkthroughStep[] = [
  {
    id: 'overview',
    target: 'account-sidebar',
    titleKey: 'walkthrough.account.overview.title',
    descriptionKey: 'walkthrough.account.overview.description',
    position: 'right',
  },
  {
    id: 'llm',
    target: 'account-tab-llm',
    titleKey: 'walkthrough.account.llm.title',
    descriptionKey: 'walkthrough.account.llm.description',
    position: 'right',
  },
  {
    id: 'connections',
    target: 'account-tab-connections',
    titleKey: 'walkthrough.account.connections.title',
    descriptionKey: 'walkthrough.account.connections.description',
    position: 'right',
  },
  {
    id: 'sources',
    target: 'account-tab-sources',
    titleKey: 'walkthrough.account.sources.title',
    descriptionKey: 'walkthrough.account.sources.description',
    position: 'right',
  },
];
