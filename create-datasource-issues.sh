#!/usr/bin/env bash
# Create GitHub issues for new data source integrations.
# Run from the project root after authenticating: gh auth login
# Usage: bash create-datasource-issues.sh

set -e

REPO="Empreiteiro/data-talks"

# Create labels (idempotent)
gh label create "new datasource" --description "New data source integration" --color "1d76db" --repo "$REPO" 2>/dev/null || true
gh label create "enhancement"    --description "New feature or request"     --color "a2eeef" --repo "$REPO" 2>/dev/null || true

echo "=== Creating data source issues ==="

# ---------- 1. MongoDB ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: MongoDB" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar **MongoDB** como nova fonte de dados, permitindo que usuários conectem coleções MongoDB para análise via linguagem natural.

MongoDB é o banco NoSQL mais popular do mercado e complementa naturalmente os bancos SQL já suportados (PostgreSQL/MySQL).

## Motivação

- Muitas empresas armazenam dados operacionais em MongoDB
- Permite análise de dados semi-estruturados (JSON documents)
- Amplia significativamente o público-alvo da plataforma

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_mongodb.py`
   - Usar `pymongo` (ou `motor` para async) como driver
   - Receber connection string + database + collection via metadata
   - Converter a pergunta do usuário em aggregation pipeline via LLM
   - Retornar resultados tabulares (flatten de documentos nested)

2. **Novo router** `backend/app/routers/mongodb_router.py`
   - `POST /mongodb/test-connection` — validar connection string
   - `POST /mongodb/databases` — listar databases disponíveis
   - `POST /mongodb/collections` — listar collections de um database
   - `POST /mongodb/sources/{id}/refresh-metadata` — atualizar schema

3. **Atualizar** `backend/app/routers/crud.py` e `ask.py`
   - Adicionar `"mongodb"` como tipo de source válido
   - Rotear para `ask_mongodb.py` no endpoint de perguntas

4. **Metadata esperada**:
   ```json
   {
     "connectionString": "mongodb+srv://...",
     "database": "mydb",
     "collection": "users",
     "schema": { "fields": [...] },
     "preview": [...]
   }
   ```

5. **Dependência**: Adicionar `pymongo` ao `pyproject.toml`

### Frontend

1. **Novo componente** `src/components/MongoDbSourceForm.tsx`
   - Campo para connection string
   - Seleção de database → collection (cascata)
   - Preview dos primeiros documentos com schema inferido
   - Seguir padrão de `SqlSourceForm.tsx` (ref imperativo + `connect()`)

2. **Atualizar** `src/components/AddSourceModal.tsx` — nova tab "MongoDB"
3. **Atualizar** `src/services/apiClient.ts` — métodos de discovery
4. **Atualizar** traduções em `LanguageContext`

### Testes

- Teste unitário para `ask_mongodb.py` com mock do pymongo
- Teste de integração do router com banco de teste
- Teste do componente frontend com mock da API

## Referências

- Padrão a seguir: `SqlSourceForm.tsx` + `ask_sql.py` + `sql_router.py`
- Driver: [pymongo](https://pymongo.readthedocs.io/)
ISSUE_EOF
)"

# ---------- 2. Snowflake ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: Snowflake" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar **Snowflake** como nova fonte de dados. Snowflake é um dos principais data warehouses cloud do mercado e complementa o BigQuery já suportado.

## Motivação

- Snowflake é líder de mercado em cloud data warehousing
- Muitas empresas usam Snowflake como data warehouse principal
- Complementa BigQuery para cobrir os maiores cloud DWs do mercado

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_snowflake.py`
   - Usar `snowflake-connector-python` como driver
   - Gerar SQL via LLM (similar a `ask_sql.py` / `ask_bigquery.py`)
   - Suportar autenticação via account + user + password ou key-pair

2. **Novo router** `backend/app/routers/snowflake_router.py`
   - `POST /snowflake/test-connection` — validar credenciais
   - `POST /snowflake/warehouses` — listar warehouses
   - `POST /snowflake/databases` — listar databases
   - `POST /snowflake/schemas` — listar schemas
   - `POST /snowflake/tables` — listar tabelas de um schema
   - `POST /snowflake/sources/{id}/refresh-metadata` — atualizar metadata

3. **Atualizar** `crud.py` e `ask.py` para rotear tipo `"snowflake"`

4. **Metadata esperada**:
   ```json
   {
     "account": "xy12345.us-east-1",
     "user": "analyst",
     "warehouse": "COMPUTE_WH",
     "database": "ANALYTICS",
     "schema": "PUBLIC",
     "tables": [...],
     "table_infos": [{ "table": "...", "columns": [...], "preview_rows": [...] }]
   }
   ```

5. **Dependência**: `snowflake-connector-python` no `pyproject.toml`

### Frontend

1. **Novo componente** `src/components/SnowflakeSourceForm.tsx`
   - Campos: account, user, password/key-pair
   - Seleção cascata: warehouse → database → schema → tables
   - Preview de dados e schema
   - Seguir padrão de `BigQuerySourceForm.tsx`

2. **Atualizar** `AddSourceModal.tsx` com nova tab "Snowflake"
3. **Atualizar** `apiClient.ts` com métodos de discovery
4. **Atualizar** traduções

### Testes

- Teste unitário de `ask_snowflake.py` com mock do connector
- Teste do router
- Teste do componente frontend

## Referências

- Padrão a seguir: `BigQuerySourceForm.tsx` + `ask_bigquery.py` + `bigquery_router.py`
- Driver: [snowflake-connector-python](https://docs.snowflake.com/en/developer-guide/python-connector)
ISSUE_EOF
)"

# ---------- 3. Amazon S3 / MinIO ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: Amazon S3 / MinIO" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar **Amazon S3** (e compatíveis como **MinIO**) como fonte de dados, permitindo importar arquivos CSV, JSON e Parquet diretamente de buckets S3.

## Motivação

- S3 é o padrão de facto para data lakes
- Muitas empresas armazenam dados brutos e processados em S3
- MinIO é alternativa open-source amplamente usada on-premise
- Complementa o upload local de CSV/XLSX com acesso a dados remotos em escala

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_s3.py`
   - Usar `boto3` para acessar S3 (ou endpoint compatível para MinIO)
   - Baixar arquivo do bucket → parsear com pandas (CSV, JSON, Parquet)
   - Reutilizar lógica de `ask_csv.py` após download
   - Cache local temporário para evitar downloads repetidos

2. **Novo router** `backend/app/routers/s3_router.py`
   - `POST /s3/test-connection` — validar credenciais AWS
   - `POST /s3/buckets` — listar buckets acessíveis
   - `POST /s3/objects` — listar objetos (filtrar por extensão)
   - `POST /s3/sources/{id}/refresh-metadata` — re-download e atualizar schema

3. **Atualizar** `crud.py` e `ask.py` para rotear tipo `"s3"`

4. **Metadata esperada**:
   ```json
   {
     "accessKeyId": "AKIA...",
     "secretAccessKey": "...",
     "region": "us-east-1",
     "endpoint": "https://s3.amazonaws.com",
     "bucket": "my-data-lake",
     "key": "reports/2024/sales.csv",
     "fileType": "csv",
     "schema": { "columns": [...] },
     "preview": [...],
     "rowCount": 50000
   }
   ```

5. **Dependências**: `boto3`, `pyarrow` (para Parquet) no `pyproject.toml`

### Frontend

1. **Novo componente** `src/components/S3SourceForm.tsx`
   - Campos: Access Key, Secret Key, Region, Endpoint (opcional para MinIO)
   - Browser de buckets → prefixes → arquivos
   - Filtro por extensão (csv, json, parquet)
   - Preview após seleção do arquivo

2. **Atualizar** `AddSourceModal.tsx` com nova tab "S3 / MinIO"
3. **Atualizar** `apiClient.ts`
4. **Atualizar** traduções

### Testes

- Teste com `moto` (mock S3) para backend
- Teste do componente frontend

## Referências

- Padrão a seguir: `GithubFileSourceForm.tsx` (browse remoto) + `ask_csv.py` (parsing)
- Drivers: [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html), [pyarrow](https://arrow.apache.org/docs/python/)
- Mock: [moto](https://github.com/getmoto/moto)
ISSUE_EOF
)"

# ---------- 4. REST API (Conector Genérico) ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: REST API (conector genérico)" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar um **conector genérico de REST API** como fonte de dados, permitindo que usuários conectem qualquer API REST que retorne JSON e analisem os dados via linguagem natural.

## Motivação

- Cobre infinitas fontes de dados sem precisar de um conector dedicado para cada uma
- Permite conectar APIs internas, SaaS (Stripe, HubSpot, Jira, etc.) e dados públicos
- Diferencial competitivo — poucas plataformas oferecem isso de forma simples
- Alta flexibilidade para power users

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_rest_api.py`
   - Usar `httpx` (já é dependência) para fazer requests
   - Suportar métodos GET/POST
   - Suportar headers customizados (Authorization, API keys, etc.)
   - Parsear resposta JSON → tabular (flatten automático com `pandas.json_normalize`)
   - Suportar paginação configurável (offset, cursor, page)
   - Reutilizar lógica de `ask_csv.py` após normalização

2. **Novo router** `backend/app/routers/rest_api_router.py`
   - `POST /rest-api/test` — executar request de teste e retornar preview
   - `POST /rest-api/sources/{id}/refresh-metadata` — re-fetch e atualizar schema

3. **Atualizar** `crud.py` e `ask.py` para rotear tipo `"rest_api"`

4. **Metadata esperada**:
   ```json
   {
     "url": "https://api.example.com/v1/orders",
     "method": "GET",
     "headers": { "Authorization": "Bearer ..." },
     "queryParams": { "limit": "1000" },
     "body": null,
     "dataPath": "data.results",
     "pagination": { "type": "offset", "paramName": "offset", "pageSize": 100 },
     "schema": { "columns": [...] },
     "preview": [...],
     "rowCount": 5000
   }
   ```

5. **Segurança**:
   - Validar URLs (bloquear localhost/IPs internos — SSRF)
   - Criptografar headers sensíveis no metadata
   - Rate limiting nas chamadas

### Frontend

1. **Novo componente** `src/components/RestApiSourceForm.tsx`
   - Campo URL + método (GET/POST)
   - Editor de headers (key-value pairs)
   - Campo para query params e body (JSON editor para POST)
   - Campo `dataPath` — caminho para localizar o array de dados na resposta
   - Botão "Test Request" com preview
   - Configuração de paginação (opcional)

2. **Atualizar** `AddSourceModal.tsx` com nova tab "REST API"
3. **Atualizar** `apiClient.ts`
4. **Atualizar** traduções

### Testes

- Teste com `respx` (mock httpx) para backend
- Testar proteção SSRF
- Teste do componente frontend

## Referências

- Padrão a seguir: `GithubFileSourceForm.tsx` + `ask_csv.py`
ISSUE_EOF
)"

# ---------- 5. SQLite (Upload de arquivo .db) ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: SQLite (upload de arquivo .db)" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar suporte a **upload de arquivos SQLite** (.db, .sqlite, .sqlite3) como fonte de dados. O arquivo é enviado como um upload (similar a CSV/XLSX) e permite consultas SQL completas.

## Motivação

- SQLite é o banco de dados mais implantado do mundo
- Analistas e cientistas de dados frequentemente trabalham com SQLite localmente
- Combina a simplicidade do upload de arquivo com o poder de consultas SQL
- Custo de implementação baixo — reutiliza muita lógica de `ask_sql.py`

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_sqlite.py`
   - Reutilizar grande parte de `ask_sql.py`
   - Usar `aiosqlite` (já é dependência) para queries async
   - Armazenar o arquivo .db no servidor (similar a CSVs)
   - Introspecção automática de tabelas e schemas

2. **Atualizar** upload em `crud.py`
   - Aceitar extensões `.db`, `.sqlite`, `.sqlite3` no upload
   - Detectar tipo `"sqlite"` automaticamente pela extensão
   - Introspecção: listar tabelas, colunas, preview rows

3. **Atualizar** `ask.py` para rotear tipo `"sqlite"`

4. **Metadata esperada**:
   ```json
   {
     "filePath": "/uploads/abc123.db",
     "tables": ["users", "orders", "products"],
     "table_infos": [
       { "table": "users", "columns": [...], "preview_rows": [...], "rowCount": 1500 }
     ]
   }
   ```

### Frontend

1. **Atualizar** `src/components/UploadSourceForm.tsx`
   - Adicionar `.db`, `.sqlite`, `.sqlite3` às extensões aceitas
   - Após upload, exibir lista de tabelas com preview (similar ao SqlSourceForm)

2. Nenhuma nova tab necessária — integra com o upload existente

### Testes

- Teste unitário de `ask_sqlite.py` com arquivo .db de teste
- Teste de upload com as novas extensões

## Referências

- Padrão a seguir: `ask_sql.py` (queries) + `UploadSourceForm.tsx` (upload)
- Driver: `aiosqlite` (já instalado)
ISSUE_EOF
)"

# ---------- 6. Notion Database ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: Notion Database" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar **Notion Database** como fonte de dados, permitindo conectar databases do Notion para análise via linguagem natural.

## Motivação

- Notion é uma das ferramentas de produtividade mais populares
- Muitas equipes usam databases do Notion como mini-CRM, tracker de projetos, inventário, etc.
- Dados estão estruturados em tabelas (databases) com tipos ricos
- Amplia o alcance para equipes de produto, marketing e operações

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_notion.py`
   - Usar a [Notion API](https://developers.notion.com/) via `httpx`
   - Consultar database via `POST /v1/databases/{id}/query`
   - Converter propriedades do Notion (title, rich_text, number, date, select, etc.) para colunas tabulares
   - Reutilizar lógica de `ask_csv.py` após normalização

2. **Novo router** `backend/app/routers/notion_router.py`
   - `POST /notion/test-connection` — validar integration token
   - `POST /notion/databases` — listar databases acessíveis
   - `POST /notion/sources/{id}/refresh-metadata` — re-sync

3. **Atualizar** `crud.py` e `ask.py` para rotear tipo `"notion"`

4. **Metadata esperada**:
   ```json
   {
     "integrationToken": "secret_...",
     "databaseId": "abc123...",
     "databaseTitle": "Clientes",
     "properties": [
       { "name": "Nome", "type": "title" },
       { "name": "Email", "type": "email" },
       { "name": "Status", "type": "select", "options": ["Ativo", "Inativo"] }
     ],
     "schema": { "columns": [...] },
     "preview": [...],
     "rowCount": 200
   }
   ```

### Frontend

1. **Novo componente** `src/components/NotionSourceForm.tsx`
   - Campo para Integration Token (Internal Integration)
   - Lista de databases acessíveis com seleção
   - Preview das propriedades e dados
   - Link para documentação de como criar uma Notion Integration

2. **Atualizar** `AddSourceModal.tsx` com nova tab "Notion"
3. **Atualizar** `apiClient.ts`
4. **Atualizar** traduções

### Testes

- Teste com mock da Notion API via `respx`
- Teste da normalização de propriedades
- Teste do componente frontend

## Referências

- API: [Notion API Docs](https://developers.notion.com/)
- Padrão a seguir: `GoogleSheetsSourceForm.tsx` (token + seleção) + `ask_csv.py` (dados tabulares)
ISSUE_EOF
)"

# ---------- 7. Microsoft Excel Online (OneDrive/SharePoint) ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: Microsoft Excel Online (OneDrive/SharePoint)" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Adicionar **Microsoft Excel Online** como fonte de dados, permitindo conectar planilhas armazenadas no OneDrive ou SharePoint para análise via linguagem natural.

## Motivação

- Complementa Google Sheets para cobrir o ecossistema Microsoft
- Muitas empresas usam Microsoft 365 / SharePoint como padrão
- Enorme base de usuários corporativos
- Dados frequentemente vivem em planilhas Excel compartilhadas

## Orientações de implementação

### Backend

1. **Novo script** `backend/app/scripts/ask_excel_online.py`
   - Usar Microsoft Graph API via `httpx`
   - Endpoint: `GET /drives/{drive-id}/items/{item-id}/workbook/worksheets/{sheet}/usedRange`
   - Converter range para DataFrame e reutilizar lógica de `ask_csv.py`

2. **Novo router** `backend/app/routers/excel_online_router.py`
   - `POST /excel-online/auth` — iniciar fluxo OAuth2 com Microsoft
   - `POST /excel-online/callback` — callback OAuth2
   - `POST /excel-online/files` — listar arquivos Excel no OneDrive/SharePoint
   - `POST /excel-online/sheets` — listar sheets de um arquivo
   - `POST /excel-online/sources/{id}/refresh-metadata` — re-sync

3. **Atualizar** `crud.py` e `ask.py` para rotear tipo `"excel_online"`

4. **Metadata esperada**:
   ```json
   {
     "accessToken": "...",
     "refreshToken": "...",
     "driveId": "...",
     "itemId": "...",
     "fileName": "Vendas Q4.xlsx",
     "sheetName": "Sheet1",
     "columns": [...],
     "preview": [...],
     "rowCount": 5000
   }
   ```

5. **Dependência**: Registro de app no Azure AD (client_id, client_secret)

### Frontend

1. **Novo componente** `src/components/ExcelOnlineSourceForm.tsx`
   - Botão "Sign in with Microsoft" (OAuth2 popup)
   - Após auth: browser de arquivos OneDrive/SharePoint
   - Seleção de sheet e preview
   - Seguir padrão de `GoogleSheetsSourceForm.tsx`

2. **Atualizar** `AddSourceModal.tsx` com nova tab "Excel Online"
3. **Atualizar** `apiClient.ts`
4. **Atualizar** traduções

### Testes

- Mock do Microsoft Graph API
- Teste do fluxo OAuth2
- Teste do componente frontend

## Referências

- API: [Microsoft Graph - Excel](https://learn.microsoft.com/en-us/graph/api/resources/excel)
- Padrão a seguir: `GoogleSheetsSourceForm.tsx` + `ask_google_sheets.py`
ISSUE_EOF
)"

# ---------- 8. Parquet / JSON File Upload ----------
gh issue create --repo "$REPO" \
  --title "Nova fonte de dados: Upload de arquivos Parquet e JSON" \
  --label "enhancement,new datasource" \
  --body "$(cat <<'ISSUE_EOF'
## Descrição

Expandir o upload de arquivos para suportar **Parquet** (.parquet) e **JSON** (.json, .jsonl) além dos CSV/XLSX já suportados.

## Motivação

- Parquet é o formato padrão em pipelines de dados modernos (Spark, dbt, data lakes)
- JSON/JSONL é onipresente em logs, exports de APIs e dados semi-estruturados
- Custo de implementação muito baixo — reutiliza quase toda a infraestrutura existente
- Quick win de alto valor para data engineers

## Orientações de implementação

### Backend

1. **Atualizar** `backend/app/routers/crud.py` (endpoint de upload)
   - Aceitar extensões `.parquet`, `.json`, `.jsonl`
   - Para Parquet: usar `pandas.read_parquet()` (requer `pyarrow`)
   - Para JSON: usar `pandas.read_json()` com detecção automática de `lines=True` para JSONL
   - Para JSON nested: aplicar `pandas.json_normalize()` para flatten automático
   - Gerar schema e preview da mesma forma que CSV/XLSX

2. **Atualizar** `backend/app/scripts/ask_csv.py`
   - Adicionar lógica para carregar Parquet e JSON (além de CSV/XLSX)
   - Detecção pelo campo `type` no metadata (`"parquet"`, `"json"`)

3. **Tipos novos**: `"parquet"`, `"json"` no tipo de source

4. **Metadata** (mesma estrutura de CSV):
   ```json
   {
     "schema": { "columns": [...] },
     "preview": [...],
     "rowCount": 150000
   }
   ```

5. **Dependência**: `pyarrow` no `pyproject.toml` (para Parquet)

### Frontend

1. **Atualizar** `src/components/UploadSourceForm.tsx`
   - Adicionar `.parquet`, `.json`, `.jsonl` às extensões aceitas no dropzone
   - Atualizar texto de ajuda para listar formatos suportados
   - Para JSON nested: mostrar aviso de que será feito flatten automático

2. Nenhuma nova tab necessária — integra com o upload existente

### Testes

- Teste de upload para cada formato
- Teste de parsing de JSON nested com flatten
- Teste de JSONL (newline-delimited)
- Teste com arquivo Parquet gerado via pyarrow

## Referências

- Padrão a seguir: Extensão direta de `UploadSourceForm.tsx` + `ask_csv.py`
- [pandas.read_parquet](https://pandas.pydata.org/docs/reference/api/pandas.read_parquet.html)
- [pandas.read_json](https://pandas.pydata.org/docs/reference/api/pandas.read_json.html)
- [pandas.json_normalize](https://pandas.pydata.org/docs/reference/api/pandas.json_normalize.html)
ISSUE_EOF
)"

echo ""
echo "=== All 8 data source issues created successfully ==="
