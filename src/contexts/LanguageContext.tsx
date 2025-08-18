import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Language = 'en' | 'pt';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations = {
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.account': 'Account',
    'nav.logout': 'Logout',
    'nav.getStarted': 'Get Started',
    'nav.tagline': 'Talk to your data',
    
    // Hero Section
    'hero.title': 'Turn your data into intelligent conversations',
    'hero.subtitle': 'Connect your data sources and ask questions in natural language. Get instant insights without complex queries.',
    'hero.getStarted': 'Get Started',
    'hero.howItWorks': 'How it works',
    
    // How it works
    'howItWorks.title': 'How it works',
    'howItWorks.step1.title': 'Connect your data',
    'howItWorks.step1.description': 'Upload CSV files, connect to BigQuery, or add other data sources',
    'howItWorks.step2.title': 'Ask questions',
    'howItWorks.step2.description': 'Use natural language to query your data',
    'howItWorks.step3.title': 'Get insights',
    'howItWorks.step3.description': 'Receive instant answers with charts and visualizations',
    
    // Benefits
    'benefits.title': 'Benefits',
    'benefits.easy.title': 'Easy to use',
    'benefits.easy.description': 'No need to learn SQL or complex query languages',
    'benefits.fast.title': 'Fast insights',
    'benefits.fast.description': 'Get answers in seconds, not hours',
    'benefits.secure.title': 'Secure',
    'benefits.secure.description': 'Your data remains private and secure',
  },
  pt: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.account': 'Conta',
    'nav.logout': 'Sair',
    'nav.getStarted': 'Começar agora',
    'nav.tagline': 'Converse com seus dados',
    
    // Hero Section
    'hero.title': 'Transforme seus dados em conversas inteligentes',
    'hero.subtitle': 'Conecte suas fontes de dados e faça perguntas em linguagem natural. Obtenha insights instantâneos sem consultas complexas.',
    'hero.getStarted': 'Começar agora',
    'hero.howItWorks': 'Como funciona',
    
    // How it works
    'howItWorks.title': 'Como funciona',
    'howItWorks.step1.title': 'Conecte seus dados',
    'howItWorks.step1.description': 'Carregue arquivos CSV, conecte ao BigQuery ou adicione outras fontes de dados',
    'howItWorks.step2.title': 'Faça perguntas',
    'howItWorks.step2.description': 'Use linguagem natural para consultar seus dados',
    'howItWorks.step3.title': 'Obtenha insights',
    'howItWorks.step3.description': 'Receba respostas instantâneas com gráficos e visualizações',
    
    // Benefits
    'benefits.title': 'Benefícios',
    'benefits.easy.title': 'Fácil de usar',
    'benefits.easy.description': 'Não é necessário aprender SQL ou linguagens de consulta complexas',
    'benefits.fast.title': 'Insights rápidos',
    'benefits.fast.description': 'Obtenha respostas em segundos, não em horas',
    'benefits.secure.title': 'Seguro',
    'benefits.secure.description': 'Seus dados permanecem privados e seguros',
  }
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};