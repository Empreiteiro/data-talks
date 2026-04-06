import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { AudioWaveform, Bell, ChevronRight, FileBarChart, FileText, GitBranch, Hash, Layers, LayoutTemplate, Lock, MessageCircle, Network, Send, Terminal } from "lucide-react";
import { toast } from "sonner";

interface StudioPanelProps {
  onAddNote?: () => void;
  onOpenGraph?: () => void;
  onOpenSummary?: () => void;
  onOpenAudio?: () => void;
  onOpenTelegram?: () => void;
  onOpenAutoML?: () => void;
  onOpenWhatsApp?: () => void;
  onOpenReport?: () => void;
  onOpenTemplates?: () => void;
  onOpenSlack?: () => void;
  onOpenApiAccess?: () => void;
  onOpenMedallion?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function StudioPanel({ onAddNote, onOpenGraph, onOpenSummary, onOpenAudio, onOpenAutoML, onOpenReport, onOpenTemplates, onOpenTelegram, onOpenWhatsApp, onOpenSlack, onOpenApiAccess, onOpenMedallion, collapsed, onToggleCollapse }: StudioPanelProps) {
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
      locked: true,
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
      icon: MessageCircle,
      title: "WhatsApp",
      description: t('studio.connectWhatsApp'),
      locked: false,
      onClick: onOpenWhatsApp,
    },
    {
      icon: Hash,
      title: "Slack",
      description: t('studio.connectSlack'),
      locked: false,
      onClick: onOpenSlack,
    },
    {
      icon: Send,
      title: "Telegram",
      description: t('studio.connectTelegram'),
      locked: false,
      onClick: onOpenTelegram,
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

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between h-[57px]">
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

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Studio Section */}
        <div>
          <div className="grid grid-cols-3 gap-2">
            {studioOptions.map((option) => (
              <Card
                key={option.title}
                className={`p-2 cursor-pointer transition-all ${
                  option.locked
                    ? "opacity-50 hover:opacity-75"
                    : "hover:shadow-md hover:border-blue-400"
                }`}
                onClick={option.locked ? handleLockedClick : option.onClick}
              >
                <div className="flex flex-col items-center justify-center text-center gap-1.5 py-2">
                  <div className="relative">
                    <option.icon className="h-5 w-5 text-muted-foreground" />
                    {option.locked && (
                      <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5">
                        <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium leading-tight">{option.title}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Connections Section */}
        <div className="border-t pt-3">
          <h3 className="text-xs font-semibold mb-2 text-muted-foreground">{t('studio.connections')}</h3>
          <div className="grid grid-cols-4 gap-2">
            {connectionOptions.map((option) => (
              <Card
                key={option.title}
                className={`p-2 cursor-pointer transition-all ${
                  option.locked
                    ? "opacity-50 hover:opacity-75"
                    : "hover:shadow-md hover:border-blue-400"
                }`}
                onClick={option.locked ? handleLockedClick : option.onClick}
              >
                <div className="flex flex-col items-center justify-center text-center gap-1.5 py-2">
                  <div className="relative">
                    <option.icon className="h-5 w-5 text-muted-foreground" />
                    {option.locked && (
                      <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5">
                        <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium leading-tight">{option.title}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

      </div>

      <div className="p-3 border-t">
        <Button
          variant="outline"
          className="w-full h-9 text-xs opacity-50 cursor-not-allowed"
          onClick={onAddNote}
          disabled
        >
          <Lock className="h-3.5 w-3.5 mr-1.5" />
          {t('studio.addNote')}
        </Button>
      </div>
    </div>
  );
}
