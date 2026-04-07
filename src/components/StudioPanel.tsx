import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { AudioWaveform, Bell, ChevronRight, FileBarChart, FileText, GitBranch, Layers, LayoutTemplate, Lock, MessageSquare, Network, Terminal } from "lucide-react";
import { toast } from "sonner";

interface StudioPanelProps {
  onOpenGraph?: () => void;
  onOpenSummary?: () => void;
  onOpenAudio?: () => void;
  onOpenAutoML?: () => void;
  onOpenReport?: () => void;
  onOpenTemplates?: () => void;
  onOpenMessaging?: () => void;
  onOpenApiAccess?: () => void;
  onOpenMedallion?: () => void;
  onOpenAlerts?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function StudioPanel({ onOpenGraph, onOpenSummary, onOpenAudio, onOpenAutoML, onOpenReport, onOpenTemplates, onOpenMessaging, onOpenApiAccess, onOpenMedallion, onOpenAlerts, collapsed, onToggleCollapse }: StudioPanelProps) {
  const { t } = useLanguage();
  
  const studioOptions: Array<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    locked: boolean;
    onClick?: () => void;
  }> = [
    {
      icon: GitBranch,
      title: "Graph",
      description: t('studio.graphDescription'),
      locked: false,
      onClick: onOpenGraph,
    },
    {
      icon: FileBarChart,
      title: t('studio.summaryTitle'),
      description: t('studio.summaryCardDescription'),
      locked: false,
      onClick: onOpenSummary,
    },
    {
      icon: AudioWaveform,
      title: "Audio",
      description: t('studio.audioOverview'),
      locked: false,
      onClick: onOpenAudio,
    },
    {
      icon: Layers,
      title: "Medallion",
      description: "Bronze → Silver → Gold",
      locked: false,
      onClick: onOpenMedallion,
    },
    {
      icon: Network,
      title: "Auto ML",
      description: t('studio.autoML'),
      locked: false,
      onClick: onOpenAutoML,
    },
    {
      icon: FileText,
      title: "Reports",
      description: t('studio.reports'),
      locked: false,
      onClick: onOpenReport,
    },
    {
      icon: LayoutTemplate,
      title: t('studio.templates'),
      description: t('studio.templateDescription'),
      locked: false,
      onClick: onOpenTemplates,
    },
    {
      icon: Bell,
      title: "Alerts",
      description: t('studio.alertConfig'),
      locked: false,
      onClick: onOpenAlerts,
    },
  ];

  const connectionOptions: Array<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    locked: boolean;
    onClick?: () => void;
  }> = [
    {
      icon: MessageSquare,
      title: "Messaging",
      description: "WhatsApp, Slack, Telegram",
      locked: false,
      onClick: onOpenMessaging,
    },
    {
      icon: Terminal,
      title: "API",
      description: t('studio.connectApi'),
      locked: false,
      onClick: onOpenApiAccess,
    },
  ];

  const handleLockedClick = () => {
    toast.info(t('studio.comingSoon'), {
      description: t('studio.comingSoonDescription'),
    });
  };

  const allOptions = [
    ...studioOptions,
    ...connectionOptions,
  ];

  // Total rows needed: ceil(items / 2)
  const totalRows = Math.ceil(allOptions.length / 2);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 border-b flex items-center justify-between h-[57px]">
        <h2 className="font-semibold">{t('studio.title')}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onToggleCollapse}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          className="grid grid-cols-2 gap-2 h-full"
          style={{ gridTemplateRows: `repeat(${totalRows}, 1fr)` }}
        >
          {allOptions.map((option) => (
            <Card
              key={option.title}
              className={`cursor-pointer transition-all flex items-center justify-center ${
                option.locked
                  ? "opacity-50 hover:opacity-75"
                  : "hover:shadow-md hover:border-blue-400"
              }`}
              onClick={option.locked ? handleLockedClick : option.onClick}
            >
              <div className="flex flex-col items-center justify-center text-center gap-1.5">
                <div className="relative">
                  <option.icon className="h-6 w-6 text-muted-foreground" />
                  {option.locked && (
                    <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5">
                      <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <p className="text-xs font-semibold leading-tight">{option.title}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
