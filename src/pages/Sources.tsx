import { SEO } from "@/components/SEO";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMemo, useRef, useState } from "react";
import { agentClient, Source } from "@/services/agentClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { X, Trash2 } from "lucide-react";

const Sources = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [created, setCreated] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const credRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    try {
      setLoading(true);
      const sources = await agentClient.uploadFiles(files);
      setCreated((prev) => [...sources, ...prev]);
      setFiles([]);
    } catch (e: any) {
      alert(e.message);
    } finally { setLoading(false); }
  }

  async function handleBQ(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = (credRef.current?.files?.[0]);
    if (!file) return alert('Selecione o JSON de credenciais');
    try {
      const src = await agentClient.connectBigQuery(file, {
        project: String(data.get('project') || ''),
        dataset: String(data.get('dataset') || ''),
        tables: String(data.get('tables') || '').split(',').map(s => s.trim()).filter(Boolean)
      });
      setCreated((prev) => [src, ...prev]);
      e.currentTarget.reset();
      if (credRef.current) credRef.current.value = '';
    } catch (e: any) { alert(e.message); }
  }

  function handleDelete(sourceId: string) {
    if (confirm('Tem certeza que deseja deletar esta fonte de dados?')) {
      agentClient.deleteSource(sourceId);
      setCreated(prev => prev.filter(s => s.id !== sourceId));
      setRefreshKey(prev => prev + 1);
    }
  }

  const existing = agentClient.listSources();
  const displayed = useMemo(() => {
    const map = new Map<string, Source>();
    [...created, ...existing].forEach((s) => {
      if (!map.has(s.id)) map.set(s.id, s);
    });
    return Array.from(map.values());
  }, [created, existing, refreshKey]);

  return (
    <main className="container py-10">
      <SEO title="Fontes | Converse com seus dados" description="Envie CSV/XLSX ou conecte seu BigQuery" canonical="/sources" />
      <h1 className="text-3xl font-semibold mb-6">Fontes de Dados</h1>
      <Tabs defaultValue="files" className="mb-8">
        <TabsList>
          <TabsTrigger value="files">Arquivos (CSV/XLSX)</TabsTrigger>
          <TabsTrigger value="bq">Google BigQuery</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="mt-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <Input type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            <Button onClick={handleUpload} disabled={!files.length || loading}>{loading ? 'Enviando...' : 'Fazer upload'}</Button>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {files.map((f, idx) => (
                <span
                  key={`${f.name}-${f.size}-${f.lastModified}`}
                  className="inline-flex items-center gap-2 rounded-md bg-secondary text-secondary-foreground px-2.5 py-1 text-xs"
                >
                  <span className="font-medium">{f.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1"
                    aria-label={`Remover ${f.name}`}
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </span>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="bq" className="mt-6">
          <form onSubmit={handleBQ} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Credenciais (JSON)</Label>
              <Input type="file" accept="application/json" ref={credRef} />
            </div>
            <div className="space-y-2">
              <Label>Projeto</Label>
              <Input name="project" placeholder="meu-projeto" />
            </div>
            <div className="space-y-2">
              <Label>Dataset</Label>
              <Input name="dataset" placeholder="analytics" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Tabelas permitidas (separadas por vírgula)</Label>
              <Input name="tables" placeholder="orders, customers" />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Conectar BigQuery</Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      <div className="grid gap-6">
        {displayed.map((s) => (
          <Card key={s.id} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{s.name} <span className="text-sm text-muted-foreground">[{s.type}]</span></CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(s.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {s.type === 'file' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span><strong>{s.metaJSON.rowCount || 0}</strong> linhas</span>
                    <span><strong>{Object.keys(s.metaJSON.schema).length}</strong> colunas</span>
                  </div>
                  <div>
                    <p className="font-medium mb-2">Schema inferido</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(s.metaJSON.schema).map(([k, v]) => (
                        <div key={k} className="text-sm bg-secondary rounded-md px-3 py-2 flex items-center justify-between">
                          <span className="font-medium">{k}</span>
                          <span className="text-muted-foreground">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="font-medium mb-2">Preview</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(s.metaJSON.schema).map((col) => (
                              <TableHead key={col}>{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(s.metaJSON.preview as any[]).map((row, i) => (
                            <TableRow key={i}>
                              {Object.keys(s.metaJSON.schema).map((col) => (
                                <TableCell key={col}>{String(row[col] ?? '')}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Projeto: {s.metaJSON.project || '—'} | Dataset: {s.metaJSON.dataset || '—'} | Tabelas: {(s.metaJSON.tables||[]).join(', ') || '—'}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
};

export default Sources;
