import NavBar from "@/components/layout/NavBar";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

const Index = () => {
  const { isAuthenticated, initializing } = useAuth();
  const { t } = useLanguage();
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
      <SEO title={t('nav.tagline')} description={t('hero.subtitle')} canonical="/" />
      <section ref={heroRef} className="relative overflow-hidden interactive-gradient">
        <div className="container py-28 text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">{t('hero.title')}</h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">{t('hero.subtitle')}</p>
          <div className="flex items-center justify-center gap-3">
            <Button asChild>
              <Link to="/login">{t('hero.getStarted')}</Link>
            </Button>
            <Button variant="secondary" asChild>
              <a href="#como-funciona">{t('hero.howItWorks')}</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="container py-20">
        <h2 className="text-3xl font-semibold text-center mb-10">{t('howItWorks.title')}</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { title: t('howItWorks.step1.title'), description: t('howItWorks.step1.description') },
            { title: t('howItWorks.step2.title'), description: t('howItWorks.step2.description') },
            { title: t('howItWorks.step3.title'), description: t('howItWorks.step3.description') },
            { title: 'Alertas', description: 'Crie alertas para monitorar métricas e receber notificações.' }
          ].map((step, i) => (
            <div key={i} className="rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="text-sm text-primary font-semibold mb-2">Passo {i+1}</div>
              <h3 className="font-medium mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container py-16">
        <h2 className="text-3xl font-semibold text-center mb-10">{t('benefits.title')}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { title: t('benefits.easy.title'), description: t('benefits.easy.description') },
            { title: t('benefits.fast.title'), description: t('benefits.fast.description') },
            { title: t('benefits.secure.title'), description: t('benefits.secure.description') }
          ].map((benefit) => (
            <div key={benefit.title} className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-medium mb-2">{benefit.title}</h3>
              <p className="text-sm text-muted-foreground">{benefit.description}</p>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
};

export default Index;
