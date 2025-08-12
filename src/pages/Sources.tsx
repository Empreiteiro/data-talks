import { SEO } from "@/components/SEO";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMemo, useRef, useState } from "react";
import { supabaseClient } from "@/services/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { X, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const Sources = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const credRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });

  async function handleDelete(sourceId: string) {
    if (confirm('Tem certeza que deseja deletar esta fonte de dados?')) {
      try {
        await supabaseClient.deleteSource(sourceId);
        queryClient.invalidateQueries({ queryKey: ['sources'] });
      } catch (e: any) {
        alert(e.message);
      }
    }
  }

  async function handleUpload() {
    if (!files.length) return;
    
    setLoading(true);
    try {
      for (const file of files) {
        await supabaseClient.uploadFile(file);
      }
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(`Erro no upload: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleBQ(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    alert('Conexão BigQuery será implementada em breve. Use o Supabase para dados por enquanto.');
  }

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
        {sources.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">
                Nenhuma fonte de dados encontrada. Faça upload de arquivos CSV ou XLSX acima.
              </p>
            </CardContent>
          </Card>
        ) : (
          sources.map((s: any) => (
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
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    Criado em: {new Date(s.created_at).toLocaleString('pt-BR')}
                  </div>
                  
                  {s.metadata && (
                    <div className="space-y-3">
                      {s.metadata.row_count > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">Linhas:</span> {s.metadata.row_count.toLocaleString('pt-BR')}
                        </div>
                      )}
                      
                      {s.metadata.columns && s.metadata.columns.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Colunas ({s.metadata.columns.length}):</div>
                          <div className="flex flex-wrap gap-1">
                            {s.metadata.columns.map((col: string, idx: number) => (
                              <span key={idx} className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                {col}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {s.metadata.preview_rows && s.metadata.preview_rows.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Primeiras linhas:</div>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {s.metadata.columns?.map((col: string, idx: number) => (
                                    <TableHead key={idx} className="text-xs">{col}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {s.metadata.preview_rows.slice(0, 3).map((row: any, rowIdx: number) => (
                                  <TableRow key={rowIdx}>
                                    {s.metadata.columns?.map((col: string, colIdx: number) => (
                                      <TableCell key={colIdx} className="text-xs max-w-32 truncate">
                                        {row[col]?.toString() || '-'}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                      
                      {s.metadata.file_size && (
                        <div className="text-sm text-muted-foreground">
                          Tamanho: {(s.metadata.file_size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
};

export default Sources;
