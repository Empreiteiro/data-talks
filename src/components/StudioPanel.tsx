import { Lock, AudioWaveform, Network, FileText, MessageCircle, Hash, Bell, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface StudioPanelProps {
  onAddNote?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function StudioPanel({ onAddNote, collapsed, onToggleCollapse }: StudioPanelProps) {
  const { t } = useLanguage();
  
  const studioOptions = [
    {
      icon: AudioWaveform,
      title: "Audio",
      description: t('studio.audioOverview'),
      locked: true,
    },
    {
      icon: Network,
      title: "Auto ML",
      description: t('studio.autoML'),
      locked: true,
    },
    {
      icon: FileText,
      title: "Reports",
      description: t('studio.reports'),
      locked: true,
    },
    {
      icon: Bell,
      title: "Alerts",
      description: t('studio.alertConfig'),
      locked: true,
    },
  ];

  const connectionOptions = [
    {
      icon: MessageCircle,
      title: "WhatsApp",
      description: t('studio.connectWhatsApp'),
      locked: true,
    },
    {
      icon: Hash,
      title: "Slack",
      description: t('studio.connectSlack'),
      locked: true,
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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Studio Section */}
        <div>
          <div className="grid grid-cols-2 gap-3">
            {studioOptions.map((option) => (
              <Card
                key={option.title}
                className={`p-4 cursor-pointer transition-all h-28 ${
                  option.locked
                    ? "opacity-50 hover:opacity-75"
                    : "hover:shadow-md"
                }`}
                onClick={option.locked ? handleLockedClick : undefined}
              >
                <div className="flex flex-col items-center justify-center text-center gap-2 h-full">
                  <div className="relative">
                    <option.icon className="h-8 w-8 text-muted-foreground" />
                    {option.locked && (
                      <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium">{option.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Connections Section */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-3">{t('studio.connections')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {connectionOptions.map((option) => (
              <Card
                key={option.title}
                className={`p-4 cursor-pointer transition-all h-28 ${
                  option.locked
                    ? "opacity-50 hover:opacity-75"
                    : "hover:shadow-md"
                }`}
                onClick={option.locked ? handleLockedClick : undefined}
              >
                <div className="flex flex-col items-center justify-center text-center gap-2 h-full">
                  <div className="relative">
                    <option.icon className="h-8 w-8 text-muted-foreground" />
                    {option.locked && (
                      <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium">{option.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

      </div>

      <div className="p-4 border-t">
        <Button
          variant="outline"
          className="w-full h-12 opacity-50 cursor-not-allowed"
          onClick={onAddNote}
          disabled
        >
          <Lock className="h-4 w-4 mr-2" />
          {t('studio.addNote')}
        </Button>
      </div>
    </div>
  );
}
