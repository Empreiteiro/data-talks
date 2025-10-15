import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [instructions, setInstructions] = useState("");
  const [warmupQuestions, setWarmupQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && agentId) {
      loadSettings();
    }
  }, [open, agentId]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('instructions, suggested_questions')
        .eq('id', agentId)
        .single();

      if (error) throw error;

      setInstructions(data?.instructions || "");
      setWarmupQuestions(data?.suggested_questions || []);
    } catch (error: any) {
      console.error("Erro ao carregar configurações:", error);
      toast.error("Erro ao carregar configurações");
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('agents')
        .update({
          instructions,
          suggested_questions: warmupQuestions,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

      if (error) throw error;

      toast.success("Configurações salvas com sucesso");
      onSettingsUpdated?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Erro ao salvar configurações:", error);
      toast.error("Erro ao salvar configurações");
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
          <DialogTitle>Configurações do Agente</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Orientações Específicas */}
          <div className="space-y-2">
            <Label htmlFor="instructions">Orientações Específicas para o Agente</Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Digite as orientações específicas que o agente deve seguir ao responder perguntas..."
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Essas orientações serão usadas pelo agente para personalizar as respostas.
            </p>
          </div>

          {/* Perguntas de Aquecimento */}
          <div className="space-y-2">
            <Label>Perguntas de Aquecimento</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Essas perguntas aparecerão abaixo das colunas disponíveis para ajudar os usuários a começar.
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
                placeholder="Digite uma nova pergunta de aquecimento..."
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
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
