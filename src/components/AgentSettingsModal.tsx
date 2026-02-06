import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";
import { dataClient } from "@/services/supabaseClient";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface AgentSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  onSettingsUpdated?: () => void;
}

export function AgentSettingsModal({
  open,
  onOpenChange,
  agentId,
  onSettingsUpdated
}: AgentSettingsModalProps) {
  const { t } = useLanguage();
  const [instructions, setInstructions] = useState("");
  const [warmupQuestions, setWarmupQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && agentId) {
      loadSettings();
    }
  }, [open, agentId]);

  const [agentName, setAgentName] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const loadSettings = async () => {
    try {
      const agent = await dataClient.getAgent(agentId);
      setInstructions(agent?.description || "");
      setWarmupQuestions(agent?.suggested_questions || []);
      setAgentName(agent?.name || "");
      setSourceIds(agent?.source_ids || []);
    } catch (error: any) {
      console.error("Erro ao carregar configurações:", error);
      toast.error(t('agentSettings.loadError'));
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await dataClient.updateAgent(agentId, agentName, sourceIds, instructions, warmupQuestions);
      toast.success(t('agentSettings.saveSuccess'));
      onSettingsUpdated?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Erro ao salvar configurações:", error);
      toast.error(t('agentSettings.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = () => {
    if (newQuestion.trim()) {
      setWarmupQuestions([...warmupQuestions, newQuestion.trim()]);
      setNewQuestion("");
    }
  };

  const removeQuestion = (index: number) => {
    setWarmupQuestions(warmupQuestions.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('agentSettings.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Orientações Específicas */}
          <div className="space-y-2">
            <Label htmlFor="instructions">{t('agentSettings.instructions')}</Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t('agentSettings.instructionsPlaceholder')}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              {t('agentSettings.instructionsHelp')}
            </p>
          </div>

          {/* Perguntas de Aquecimento */}
          <div className="space-y-2">
            <Label>{t('agentSettings.warmupQuestions')}</Label>
            <p className="text-xs text-muted-foreground mb-3">
              {t('agentSettings.warmupQuestionsHelp')}
            </p>

            {/* Lista de perguntas existentes */}
            <div className="space-y-2 mb-3">
              {warmupQuestions.map((question, index) => (
                <div key={index} className="flex items-start gap-2 p-2 bg-muted rounded-md">
                  <p className="flex-1 text-sm">{question}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => removeQuestion(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Adicionar nova pergunta */}
            <div className="flex gap-2">
              <Input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder={t('agentSettings.addQuestion')}
                onKeyPress={(e) => e.key === "Enter" && addQuestion()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={addQuestion}
                disabled={!newQuestion.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Botões de ação */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('agentSettings.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? t('agentSettings.saving') : t('agentSettings.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
