import { WalkthroughStep } from '../types';

export const dashboardSteps: WalkthroughStep[] = [
  {
    id: 'overview',
    target: 'dash-header',
    titleKey: 'walkthrough.dashboard.overview.title',
    descriptionKey: 'walkthrough.dashboard.overview.description',
    position: 'bottom',
  },
  {
    id: 'charts',
    target: 'dash-charts-grid',
    titleKey: 'walkthrough.dashboard.charts.title',
    descriptionKey: 'walkthrough.dashboard.charts.description',
    position: 'top',
    optional: true,
  },
  {
    id: 'actions',
    target: 'dash-chart-actions',
    titleKey: 'walkthrough.dashboard.actions.title',
    descriptionKey: 'walkthrough.dashboard.actions.description',
    position: 'left',
    optional: true,
  },
];
