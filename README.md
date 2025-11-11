# Data Talk

Uma plataforma inteligente para análise de dados que permite conectar fontes de dados, configurar agentes de IA e obter insights através de perguntas em linguagem natural.

## 🚀 Visão Geral

O Data Talk é uma aplicação web que transforma a forma como você interage com seus dados. Através de uma interface intuitiva, você pode:

- **Conectar fontes de dados** (CSV, XLSX, BigQuery)
- **Configurar agentes de IA** personalizados
- **Fazer perguntas** em linguagem natural sobre seus dados
- **Receber respostas visuais** com gráficos e tabelas
- **Configurar alertas** para monitoramento contínuo

## ✨ Funcionalidades Principais

### 🔗 Gerenciamento de Fontes de Dados
- **Upload de arquivos**: Suporte para CSV e XLSX
- **Conexão BigQuery**: Integração direta com Google BigQuery
- **Metadados automáticos**: Detecção automática de colunas e tipos de dados
- **Visualização de dados**: Preview das primeiras linhas dos dados

### 🤖 Agentes de IA
- **Configuração personalizada**: Nome, descrição e fontes de dados
- **Perguntas sugeridas**: Sugestões automáticas baseadas nos dados
- **Histórico de conversas**: Rastreamento completo das interações
- **Compartilhamento**: Opção de tornar agentes públicos ou privados

### 💬 Sistema de Perguntas e Respostas
- **Interface conversacional**: Faça perguntas em português ou inglês
- **Respostas visuais**: Gráficos e tabelas gerados automaticamente
- **Perguntas de acompanhamento**: Sugestões para aprofundar a análise
- **Feedback do usuário**: Sistema de avaliação das respostas

### 🔔 Sistema de Alertas
- **Monitoramento contínuo**: Configure alertas recorrentes
- **Frequência personalizável**: Diário, semanal ou mensal
- **Notificações**: Receba alertas sobre mudanças nos dados

### 🌐 Internacionalização
- **Suporte multilíngue**: Português e Inglês
- **Persistência de idioma**: Lembra sua preferência entre sessões
- **Interface adaptativa**: Todos os textos são traduzidos dinamicamente

## 🛠️ Tecnologias Utilizadas

### Frontend
- **React 18**: Biblioteca para construção de interfaces
- **TypeScript**: Tipagem estática para maior confiabilidade
- **Vite**: Build tool rápido para desenvolvimento
- **Tailwind CSS**: Framework CSS utilitário
- **shadcn/ui**: Componentes de UI modernos e acessíveis

### Backend & Infraestrutura
- **Supabase**: Backend-as-a-Service com PostgreSQL
- **Edge Functions**: Funções serverless para processamento
- **BigQuery**: Integração com Google Cloud para análise de dados
- **LangFlow**: Integração para processamento de linguagem natural

### Estado & Gerenciamento
- **React Context API**: Gerenciamento de estado global
- **React Query**: Gerenciamento de estado do servidor
- **Local Storage**: Persistência de preferências do usuário

## 📁 Estrutura do Projeto

```
data-talk/
├── src/
│   ├── components/          # Componentes reutilizáveis
│   │   ├── layout/         # Componentes de layout (NavBar, Footer)
│   │   └── ui/            # Componentes de UI (botões, formulários, etc.)
│   ├── contexts/           # Contextos React (LanguageContext)
│   ├── hooks/              # Hooks customizados
│   ├── integrations/       # Integrações externas (Supabase)
│   ├── lib/                # Utilitários e helpers
│   ├── pages/              # Páginas da aplicação
│   └── services/           # Serviços e clientes de API
├── supabase/               # Configurações e funções Supabase
│   ├── functions/          # Edge Functions
│   └── migrations/         # Migrações do banco de dados
└── public/                 # Arquivos estáticos
```

## 🚀 Como Executar

### Pré-requisitos
- Node.js 18+ e npm
- Conta Supabase
- (Opcional) Projeto Google Cloud com BigQuery habilitado

### Instalação

1. **Clone o repositório**
   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd data-talk
   ```

2. **Instale as dependências**
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente**
   Crie um arquivo `.env.local` na raiz do projeto:
   ```env
   VITE_SUPABASE_URL=sua_url_supabase
   VITE_SUPABASE_ANON_KEY=sua_chave_anonima_supabase
   ```

4. **Execute o projeto**
   ```bash
   npm run dev
   ```

5. **Acesse a aplicação**
   Abra [http://localhost:8080](http://localhost:8080) no seu navegador

## 📖 Como Usar

### 1. Primeiro Acesso
- Crie uma conta ou faça login
- Selecione seu idioma preferido (PT/EN)

### 2. Configurar Fontes de Dados
- Vá para a página "Sources" (/sources)
- Faça upload de arquivos CSV/XLSX ou conecte ao BigQuery
- Verifique se os metadados foram detectados corretamente

### 3. Criar um Agente
- Acesse a página "Agent" (/agent)
- Configure o nome, descrição e selecione as fontes de dados
- Adicione perguntas sugeridas para facilitar o uso

### 4. Fazer Perguntas
- Vá para a página "Questions" (/questions)
- Selecione o agente desejado
- Digite sua pergunta em linguagem natural
- Receba respostas com visualizações automáticas

### 5. Configurar Alertas (Opcional)
- Acesse a página "Alerts" (/alerts)
- Configure alertas recorrentes para monitoramento
- Defina frequência e condições

## 🔧 Scripts Disponíveis

```bash
npm run dev          # Inicia o servidor de desenvolvimento
npm run build        # Gera build de produção
npm run preview      # Preview do build de produção
npm run lint         # Executa o linter
```

## 🌍 Internacionalização

O projeto suporta português e inglês através de um sistema de traduções centralizado:

- **Contexto**: `src/contexts/LanguageContext.tsx`
- **Hook**: `useLanguage()` para acessar traduções
- **Função**: `t('chave.traducao')` para traduzir textos
- **Persistência**: Idioma salvo no localStorage

### Adicionando Novas Traduções

1. Adicione as chaves em `LanguageContext.tsx`
2. Use `t('chave.nova')` nos componentes
3. As traduções são aplicadas automaticamente

## 🚀 Deploy

### Via Lovable
1. Acesse [Lovable](https://lovable.dev)
2. Conecte seu repositório
3. Clique em "Share → Publish"

### Via Vercel/Netlify
1. Conecte o repositório ao serviço de deploy
2. Configure as variáveis de ambiente
3. Deploy automático a cada push

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 🆘 Suporte

- **Issues**: Use o sistema de issues do GitHub
- **Documentação**: Consulte os comentários no código
- **Comunidade**: Participe das discussões no repositório

---

**Data Talk** - Transformando dados em insights através de IA conversacional 🦜
