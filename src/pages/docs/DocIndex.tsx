import { useLanguage } from "@/contexts/LanguageContext";
import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { getDocStructure } from "./docStructure";

export default function DocIndex() {
  const { t, language } = useLanguage();
  const isPt = language === "pt";
  const structure = getDocStructure(isPt);

  return (
    <div className="container max-w-3xl py-8 px-4 lg:px-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground transition-colors">
          Data Talks
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">{t("doc.title")}</span>
      </nav>
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t("doc.title")}</h1>
        </div>
        <p className="text-muted-foreground text-lg max-w-2xl mb-6">{t("doc.subtitle")}</p>
      </header>
      <ul className="space-y-2">
        {structure.map((sec) => (
          <li key={sec.id}>
            <Link
              to={`/flows/${sec.id}`}
              className="block py-2 px-3 rounded-md hover:bg-muted font-medium text-foreground"
            >
              {sec.title}
            </Link>
            {sec.subs.length > 0 && (
              <ul className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
                {sec.subs.map((sub) => (
                  <li key={sub.id}>
                    <Link
                      to={`/flows/${sec.id}#${sub.id}`}
                      className="block py-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {sub.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
