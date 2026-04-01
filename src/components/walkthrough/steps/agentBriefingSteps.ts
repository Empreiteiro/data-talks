import { WalkthroughStep } from '../types';

export const agentBriefingSteps: WalkthroughStep[] = [
  {
    id: 'name-desc',
    target: 'agent-name-section',
    titleKey: 'walkthrough.agentBriefing.nameDesc.title',
    descriptionKey: 'walkthrough.agentBriefing.nameDesc.description',
    position: 'bottom',
  },
  {
    id: 'sources',
    target: 'agent-sources-section',
    titleKey: 'walkthrough.agentBriefing.sources.title',
    descriptionKey: 'walkthrough.agentBriefing.sources.description',
    position: 'top',
  },
  {
    id: 'suggested-questions',
    target: 'agent-questions-section',
    titleKey: 'walkthrough.agentBriefing.questions.title',
    descriptionKey: 'walkthrough.agentBriefing.questions.description',
    position: 'top',
    optional: true,
  },
  {
    id: 'save',
    target: 'agent-save-btn',
    titleKey: 'walkthrough.agentBriefing.save.title',
    descriptionKey: 'walkthrough.agentBriefing.save.description',
    position: 'top',
  },
];
