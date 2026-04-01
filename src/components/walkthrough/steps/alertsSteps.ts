import { WalkthroughStep } from '../types';

export const alertsSteps: WalkthroughStep[] = [
  {
    id: 'overview',
    target: 'alerts-header',
    titleKey: 'walkthrough.alerts.overview.title',
    descriptionKey: 'walkthrough.alerts.overview.description',
    position: 'bottom',
  },
  {
    id: 'create',
    target: 'alerts-form',
    titleKey: 'walkthrough.alerts.create.title',
    descriptionKey: 'walkthrough.alerts.create.description',
    position: 'right',
    optional: true,
  },
  {
    id: 'webhooks',
    target: 'alerts-webhooks',
    titleKey: 'walkthrough.alerts.webhooks.title',
    descriptionKey: 'walkthrough.alerts.webhooks.description',
    position: 'left',
    optional: true,
  },
];
