import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiUrl } from "@/config";
import { Check, Code2, Copy } from "lucide-react";
import { toast } from "sonner";

interface Source {
  id: string;
  name: string;
  type: string;
}

interface ApiSnippetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  sources?: Source[];
  apiKey?: string;
  agentSqlMode?: boolean;
}

const PLACEHOLDER_KEY = "dtk_your_api_key_here";

export function ApiSnippetModal({
  open,
  onOpenChange,
  agentId,
  sources = [],
  apiKey = "",
  agentSqlMode = false,
}: ApiSnippetModalProps) {
  const { t } = useLanguage();
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sqlMode, setSqlMode] = useState(agentSqlMode);
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = getApiUrl();
  const endpoint = `${baseUrl}/v1/ask`;
  const displayKey = apiKey || PLACEHOLDER_KEY;

  const hasSqlSources = sources.some((s) => s.type === "sql_database" || s.type === "bigquery");

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const buildBody = () => {
    const body: Record<string, unknown> = { question: "What are the top 10 records?" };
    if (selectedSourceIds.length > 0) body.source_ids = selectedSourceIds;
    if (sqlMode) body.sql_mode = true;
    return JSON.stringify(body, null, 2);
  };

  const curlSnippet = () => `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayKey}" \\
  -d '${JSON.stringify(JSON.parse(buildBody()))}'`;

  const pythonSnippet = () => `import requests

url = "${endpoint}"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "${displayKey}",
}
payload = ${buildBody()}

response = requests.post(url, json=payload, headers=headers)
data = response.json()

print(data["answer"])
# data["sessionId"]  — use to continue the conversation
# data["followUpQuestions"]  — suggested follow-up questions`;

  const jsSnippet = () => `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "${displayKey}",
  },
  body: JSON.stringify(${buildBody()}),
});

const data = await response.json();
console.log(data.answer);
// data.sessionId  — use to continue the conversation
// data.followUpQuestions  — suggested follow-up questions`;

  const continuationSnippet = () => `# Continue a conversation by passing session_id
payload = {
    "question": "And what about the bottom 10?",
    "session_id": "SESSION_ID_FROM_PREVIOUS_RESPONSE",${selectedSourceIds.length > 0 ? `\n    "source_ids": ${JSON.stringify(selectedSourceIds)},` : ""}${sqlMode ? '\n    "sql_mode": true,' : ""}
}
response = requests.post(url, json=payload, headers=headers)
data = response.json()
print(data["answer"])`;

  const copySnippet = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success(t("apiAccess.copied"));
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const CopyButton = ({ text, id }: { text: string; id: string }) => (
    <Button
      size="sm"
      variant="ghost"
      className="absolute top-2 right-2 h-7 w-7 p-0"
      onClick={() => copySnippet(text, id)}
    >
      {copied === id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="relative">
      <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto leading-relaxed pr-10">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} id={id} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Code2 className="h-5 w-5 shrink-0 text-primary" />
            {t("apiAccess.snippetTitle")}
          </DialogTitle>
          <DialogDescription className="pr-8">
            {t("apiAccess.snippetDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Endpoint */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{t("apiAccess.endpoint")}</p>
            <div className="relative">
              <code className="block rounded-lg bg-muted px-3 py-2 text-xs font-mono pr-10 break-all">
                POST {endpoint}
              </code>
              <CopyButton text={`POST ${endpoint}`} id="endpoint" />
            </div>
          </div>

          {/* Options */}
          <div className="rounded-lg border p-3 space-y-3">
            {/* Source selection */}
            {sources.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium">{t("apiAccess.snippetSources")}</p>
                <div className="space-y-1.5">
                  {sources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`src-${source.id}`}
                        checked={selectedSourceIds.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                      />
                      <Label htmlFor={`src-${source.id}`} className="text-xs cursor-pointer flex items-center gap-1.5">
                        {source.name}
                        <Badge variant="secondary" className="text-xs py-0 px-1">{source.type}</Badge>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SQL mode */}
            {hasSqlSources && (
              <div className="flex items-center gap-2">
                <Switch
                  id="sql-mode"
                  checked={sqlMode}
                  onCheckedChange={setSqlMode}
                  className="scale-75"
                />
                <Label htmlFor="sql-mode" className="text-xs cursor-pointer">
                  {t("apiAccess.snippetSqlMode")}
                </Label>
              </div>
            )}
          </div>

          {/* Code tabs */}
          <Tabs defaultValue="python">
            <TabsList className="w-full">
              <TabsTrigger value="python" className="flex-1 text-xs">Python</TabsTrigger>
              <TabsTrigger value="javascript" className="flex-1 text-xs">JavaScript</TabsTrigger>
              <TabsTrigger value="curl" className="flex-1 text-xs">cURL</TabsTrigger>
              <TabsTrigger value="continuation" className="flex-1 text-xs">Continuação</TabsTrigger>
            </TabsList>

            <TabsContent value="python" className="mt-2">
              <CodeBlock code={pythonSnippet()} id="python" />
            </TabsContent>

            <TabsContent value="javascript" className="mt-2">
              <CodeBlock code={jsSnippet()} id="javascript" />
            </TabsContent>

            <TabsContent value="curl" className="mt-2">
              <CodeBlock code={curlSnippet()} id="curl" />
            </TabsContent>

            <TabsContent value="continuation" className="mt-2">
              <CodeBlock code={continuationSnippet()} id="continuation" />
            </TabsContent>
          </Tabs>

          {/* Response format */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Response</p>
            <CodeBlock
              code={`{
  "answer": "Here is the analysis...",
  "sessionId": "uuid-of-the-session",
  "followUpQuestions": ["What about X?", "How does Y compare?"],
  "imageUrl": null,   // URL of chart image (if generated)
  "turnId": "uuid-of-this-turn"
}`}
              id="response"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
