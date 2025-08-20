import { useLanguage } from "@/contexts/LanguageContext";
import { Linkedin, Mail } from "lucide-react";

const Footer = () => {
  const { t } = useLanguage();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container py-6">
        <div className="flex items-center justify-between">
          <div className="flex-1"></div>
          <p className="text-center text-sm text-muted-foreground flex-1">
            {t('footer.copyright', { year })}
          </p>
          <div className="flex items-center gap-4 flex-1 justify-end">
            <a
              href="mailto:democh@oriontech.me"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Email"
            >
              <Mail className="h-5 w-5" />
            </a>
            <a
              href="https://www.linkedin.com/in/lucas-democh-goularte-8b290356/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="LinkedIn"
            >
              <Linkedin className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
