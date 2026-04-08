import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { AudioWaveform, Bell, ChevronRight, FileBarChart, FileText, GitBranch, GitMerge, Layers, LayoutTemplate, Lock, MessageSquare, Network, Route, Terminal, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";

interface StudioPanelProps {
  workspaceType?: string;
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
  // CDP-specific
  onOpenCdpWizard?: () => void;
  onOpenSegments?: () => void;
  onOpenProfiles?: () => void;
  // ETL-specific
  onOpenPipelines?: () => void;
  onOpenTransforms?: () => void;
  onOpenLineage?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function StudioPanel({ workspaceType = "analysis", onOpenGraph, onOpenSummary, onOpenAudio, onOpenAutoML, onOpenReport, onOpenTemplates, onOpenMessaging, onOpenApiAccess, onOpenMedallion, onOpenAlerts, onOpenCdpWizard, onOpenSegments, onOpenProfiles, onOpenPipelines, onOpenTransforms, onOpenLineage, collapsed, onToggleCollapse }: StudioPanelProps) {
  const { t } = useLanguage();
  
  type Option = {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    locked: boolean;
    onClick?: () => void;
  };

  const handleLockedClick = () => {
    toast.info(t('studio.comingSoon'), {
      description: t('studio.comingSoonDescription'),
    });
  };

  // Options per workspace type (exclusive assignment per user spec)
  const allOptions: Option[] = (() => {
    if (workspaceType === "cdp") {
      return [
        { icon: UserCheck, title: "CDP Wizard", description: "Identity resolution & enrichment", locked: false, onClick: onOpenCdpWizard },
        { icon: Users, title: "Segments", description: "Customer segmentation", locked: false, onClick: onOpenSegments },
        { icon: GitBranch, title: "Profiles", description: "Unified customer profiles", locked: false, onClick: onOpenProfiles },
        { icon: Layers, title: "Medallion", description: "Bronze → Silver → Gold", locked: false, onClick: onOpenMedallion },
        { icon: Network, title: "Auto ML", description: t('studio.autoML'), locked: false, onClick: onOpenAutoML },
      ];
    }
    if (workspaceType === "etl") {
      return [
        { icon: Route, title: "Pipelines", description: "Build data pipelines", locked: false, onClick: onOpenPipelines },
        { icon: GitMerge, title: "Transforms", description: "SQL transformations", locked: false, onClick: onOpenTransforms },
        { icon: Network, title: "Lineage", description: "Data flow graph", locked: false, onClick: onOpenLineage },
        { icon: GitBranch, title: "Graph", description: t('studio.graphDescription'), locked: false, onClick: onOpenGraph },
        { icon: Layers, title: "Medallion", description: "Bronze → Silver → Gold", locked: false, onClick: onOpenMedallion },
        { icon: Network, title: "Auto ML", description: t('studio.autoML'), locked: false, onClick: onOpenAutoML },
      ];
    }
    // analysis (default)
    return [
      { icon: FileBarChart, title: t('studio.summaryTitle'), description: t('studio.summaryCardDescription'), locked: false, onClick: onOpenSummary },
      { icon: FileText, title: "Reports", description: t('studio.reports'), locked: false, onClick: onOpenReport },
      { icon: LayoutTemplate, title: t('studio.templates'), description: t('studio.templateDescription'), locked: false, onClick: onOpenTemplates },
      { icon: AudioWaveform, title: "Audio", description: t('studio.audioOverview'), locked: false, onClick: onOpenAudio },
      { icon: Bell, title: "Alerts", description: t('studio.alertConfig'), locked: false, onClick: onOpenAlerts },
      { icon: MessageSquare, title: "Messaging", description: "WhatsApp, Slack, Telegram", locked: false, onClick: onOpenMessaging },
      { icon: Terminal, title: "API", description: t('studio.connectApi'), locked: false, onClick: onOpenApiAccess },
    ];
  })();

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

      <div className="flex-1 min-h-0 p-3 overflow-y-auto">
        <div
          className="grid grid-cols-2 gap-2"
          style={{ gridTemplateRows: `repeat(${totalRows}, minmax(0, 100px))` }}
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
