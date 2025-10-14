import { Lock, AudioWaveform, Network, FileText, Zap, MessageCircle, Hash, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface StudioPanelProps {
  onAddNote?: () => void;
}

export function StudioPanel({ onAddNote }: StudioPanelProps) {
  const studioOptions = [
    {
      icon: AudioWaveform,
      title: "Áudio",
      description: "Audio Overview",
      locked: true,
    },
    {
      icon: Network,
      title: "Auto ML",
      description: "Auto ML",
      locked: true,
    },
    {
      icon: FileText,
      title: "Report",
      description: "Reports",
      locked: true,
    },
    {
      icon: MessageCircle,
      title: "WhatsApp",
      description: "Connect to WhatsApp",
      locked: true,
    },
    {
      icon: Hash,
      title: "Slack",
      description: "Connect to Slack",
      locked: true,
    },
    {
      icon: Zap,
      title: "Flashcards",
      description: "Flashcards",
      locked: true,
    },
  ];

  const handleLockedClick = () => {
    toast.info("Recurso em breve", {
      description: "Esta funcionalidade estará disponível em breve.",
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Studio</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {studioOptions.map((option) => (
            <Card
              key={option.title}
              className={`p-4 cursor-pointer transition-all ${
                option.locked
                  ? "opacity-50 hover:opacity-75"
                  : "hover:shadow-md"
              }`}
              onClick={option.locked ? handleLockedClick : undefined}
            >
              <div className="flex flex-col items-center text-center gap-2">
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

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground mb-3">
            A saída do Studio será salva aqui.
            Após adicionar fontes, clique para adicionar Visão Geral de Áudio, Guia de Estudo,
            Mapa Mental e mais!
          </p>
        </div>
      </div>

      <div className="p-4 border-t">
        <Button
          variant="outline"
          className="w-full"
          onClick={onAddNote}
        >
          <Plus className="h-4 w-4 mr-2" />
          Adicionar nota
        </Button>
      </div>
    </div>
  );
}
