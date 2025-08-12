import NavBar from "@/components/layout/NavBar";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { isAuthenticated, initializing } = useAuth();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!initializing && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, initializing, navigate]);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--x', x + '%');
      el.style.setProperty('--y', y + '%');
      el.style.setProperty('--x2', 100 - x + '%');
      el.style.setProperty('--y2', 100 - y + '%');
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div>
      <SEO title="Converse com seus dados" description="Conecte CSV/XLSX ou BigQuery e obtenha respostas em segundos — sem escrever SQL." canonical="/" />
      <section ref={heroRef} className="relative overflow-hidden interactive-gradient">
        <div className="container py-28 text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">Converse com seus dados.</h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">Conecte CSV/XLSX ou BigQuery e obtenha respostas em segundos — sem escrever SQL.</p>
          <div className="flex items-center justify-center gap-3">
            <Button asChild>
              <Link to="/login">Começar agora</Link>
            </Button>
            <Button variant="secondary" asChild>
              <a href="#como-funciona">Como funciona</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="container py-20">
        <h2 className="text-3xl font-semibold text-center mb-10">Como funciona</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[{
            t:'Enviar dados / Conectar BQ',d:'Anexe seus dados (CSV/XLSX) ou conecte o BigQuery usando a chave JSON (leitura).'
          },{t:'Descrever dados',d:'Resuma tabelas e colunas relevantes para o agente entender o contexto.'},{t:'Perguntar',d:'Pergunte em linguagem natural e veja respostas e tabelas.'},{t:'Alertas',d:'Crie alertas para monitorar métricas e receber notificações.'}].map((s,i)=> (
            <div key={i} className="rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="text-sm text-primary font-semibold mb-2">Passo {i+1}</div>
              <h3 className="font-medium mb-2">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container py-16">
        <h2 className="text-3xl font-semibold text-center mb-10">Benefícios</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {['Rapidez','Segurança','Sem SQL','Histórico','Alertas','Sem esforço'].map((b)=> (
            <div key={b} className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-medium mb-2">{b}</h3>
              <p className="text-sm text-muted-foreground">Aproveite {b.toLowerCase()} com uma experiência simples e moderna.</p>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
};

export default Index;
