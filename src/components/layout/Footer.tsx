import { useLanguage } from "@/contexts/LanguageContext";

const Footer = () => {
  const { t } = useLanguage();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container py-6">
        <p className="text-center text-sm text-muted-foreground">
          {t('footer.copyright', { year })}
        </p>
      </div>
    </footer>
  );
};

export default Footer;
