import { useState } from "react";
import { useParams } from "react-router-dom";
import { SourcesPanel } from "@/components/SourcesPanel";
import { StudioPanel } from "@/components/StudioPanel";
import { AddSourceModal } from "@/components/AddSourceModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Upload } from "lucide-react";
import { SEO } from "@/components/SEO";

export default function Notebook() {
  const { id } = useParams();
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const handleSendMessage = () => {
    if (!question.trim()) return;

    setMessages([...messages, { role: "user", content: question }]);
    setQuestion("");

    // TODO: Implementar integração com API do agente
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Esta é uma resposta de exemplo. A integração com o agente será implementada em breve.",
        },
      ]);
    }, 1000);
  };

  return (
    <div className="h-screen flex flex-col">
      <SEO title="Notebook" description="Converse com seus dados" canonical={`/notebook/${id}`} />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Sources Panel - Left */}
        <div className="w-80 border-r flex-shrink-0">
          <SourcesPanel onAddSource={() => setAddSourceOpen(true)} />
        </div>

        {/* Chat Panel - Center */}
        <div className="flex-1 flex flex-col bg-background">
          <div className="p-4 border-b">
            <h1 className="font-semibold">Chat</h1>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Upload className="h-16 w-16 text-primary mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  Adicione uma fonte para começar
                </h2>
                <p className="text-muted-foreground max-w-md mb-6">
                  Carregue documentos, conecte ao BigQuery ou adicione Google Sheets para começar a fazer perguntas aos seus dados.
                </p>
                <Button onClick={() => setAddSourceOpen(true)}>
                  Fazer upload de uma fonte
                </Button>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`rounded-lg p-4 max-w-[80%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Fazer upload de uma fonte para começar"
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  disabled={messages.length === 0}
                />
                <Button onClick={handleSendMessage} disabled={!question.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                0 fontes
              </p>
            </div>
          </div>
        </div>

        {/* Studio Panel - Right */}
        <div className="w-80 border-l flex-shrink-0">
          <StudioPanel />
        </div>
      </div>

      <AddSourceModal
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onSourceAdded={() => {
          // Reload sources
        }}
      />
    </div>
  );
}
