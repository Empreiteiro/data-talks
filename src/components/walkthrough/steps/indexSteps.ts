import { WalkthroughStep } from '../types';

export const indexSteps: WalkthroughStep[] = [
  {
    id: 'welcome',
    target: 'index-hero',
    titleKey: 'walkthrough.index.welcome.title',
    descriptionKey: 'walkthrough.index.welcome.description',
    position: 'bottom',
  },
  {
    id: 'create-workspace',
    target: 'index-create-btn',
    titleKey: 'walkthrough.index.create.title',
    descriptionKey: 'walkthrough.index.create.description',
    position: 'bottom',
  },
  {
    id: 'agent-cards',
    target: 'index-agents-grid',
    titleKey: 'walkthrough.index.agents.title',
    descriptionKey: 'walkthrough.index.agents.description',
    position: 'top',
    optional: true,
  },
  {
    id: 'view-sort',
    target: 'index-view-controls',
    titleKey: 'walkthrough.index.viewSort.title',
    descriptionKey: 'walkthrough.index.viewSort.description',
    position: 'bottom',
  },
];
