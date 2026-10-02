import { useCallback, useEffect, useState } from "react";
import "./_group.css";
import "./WinnersCelebration.css";

type Person = {
  name: string;
  role: string;
};

type Category = {
  id: "cuisine" | "service";
  title: string;
  caption: string;
  people: Person[];
};

const categories: Category[] = [
  {
    id: "cuisine",
    title: "Cuisine",
    caption: "Le goût du geste juste",
    people: [
      { name: "Camille Dufour", role: "Cheffe de partie" },
      { name: "Noé Lambert", role: "Commis de cuisine" },
    ],
  },
  {
    id: "service",
    title: "Service",
    caption: "L’art de recevoir",
    people: [
      { name: "Inès Favre", role: "Cheffe de rang" },
      { name: "Luca Perrin", role: "Sommelier" },
    ],
  },
];

type ResultState = "loading" | "ready" | "error";

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase("fr");
}

function Winner({ person, tied }: { person: Person; tied: boolean }) {
  const initials = getInitials(person.name);

  return (
    <article className="mm-winner">
      <div
        className="mm-portrait"
        role="img"
        aria-label={`Portrait illustré de ${person.name}, initiales ${initials}`}
      >
        <span className="mm-portrait-initials" aria-hidden="true">
          {initials}
        </span>
      </div>
      <div className="mm-winner-copy">
        <h3 className="mm-winner-name">{person.name}</h3>
        <p className="mm-winner-role">{person.role}</p>
        {tied && <span className="mm-ex-aequo">Ex æquo</span>}
      </div>
    </article>
  );
}

function CategoryPanel({ category }: { category: Category }) {
  if (category.people.length === 0) {
    return (
      <section className="mm-winner-category" aria-labelledby={`${category.id}-title`}>
        <div className="mm-category-heading">
          <h2 className="mm-category-title" id={`${category.id}-title`}>
            {category.title}
          </h2>
          <span className="mm-category-caption">{category.caption}</span>
        </div>
        <div className="mm-empty">
          <strong className="mm-empty-title">Pas de distinction ce mois-ci</strong>
          <p className="mm-empty-copy">
            Cette catégorie ne compte pas de personne distinguée pour cette période.
          </p>
        </div>
      </section>
    );
  }

  const tied = category.people.length > 1;
  return (
    <section
      className={`mm-winner-category mm-winner-category--${category.id}`}
      aria-labelledby={`${category.id}-title`}
    >
      <div className="mm-category-heading">
        <h2 className="mm-category-title" id={`${category.id}-title`}>
          {category.title}
        </h2>
        <span className="mm-category-caption">{category.caption}</span>
      </div>
      <div className="mm-winner-list">
        {category.people.map((person) => (
          <Winner key={person.name} person={person} tied={tied} />
        ))}
      </div>
    </section>
  );
}

export function WinnersCelebration() {
  const [resultState, setResultState] = useState<ResultState>("loading");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setResultState("ready"), 460);
    return () => window.clearTimeout(timeout);
  }, []);

  const retry = useCallback(() => {
    setRetrying(true);
    setResultState("loading");
    window.setTimeout(() => {
      setResultState("ready");
      setRetrying(false);
    }, 560);
  }, []);

  return (
    <main className="mm-winners">
      <div className="mm-shell">
        <header className="mm-masthead">
          <div className="mm-brand" aria-label="Molino Molard">
            <span className="mm-brand-mark" aria-hidden="true">
              M
            </span>
            <span className="mm-brand-copy">
              <strong>Molino Molard</strong>
              <small>Maison &amp; équipe</small>
            </span>
          </div>
          <span className="mm-masthead-note">Genève · au fil des saisons</span>
        </header>

        <section className="mm-intro" aria-labelledby="mm-page-title">
          <p className="mm-eyebrow">
            <span className="mm-eyebrow-line" aria-hidden="true" />
            Collaborateurs du mois
          </p>
          <h1 id="mm-page-title">
            Celles et ceux
            <br />
            <em>qui font la maison.</em>
          </h1>
          <p className="mm-intro-copy">
            Chaque mois, nous mettons à l’honneur l’énergie et le savoir-faire qui font vivre
            Molino Molard.
          </p>
          <div className="mm-intro-rule">
            <h2 className="mm-month-heading">Résultats de mai 2025</h2>
            <span className="mm-rule-mark" aria-hidden="true" />
          </div>
        </section>

        <section
          className="mm-results-region"
          aria-label="Collaborateurs distingués"
          aria-live="polite"
          aria-busy={resultState === "loading"}
        >
          {resultState === "loading" && (
            <div className="mm-loading-panel" role="status" aria-label="Chargement des résultats">
              <span className="mm-skeleton mm-skeleton-heading" />
              <div className="mm-skeleton-category">
                <span className="mm-skeleton mm-skeleton-photo" />
                <span className="mm-skeleton mm-skeleton-copy" />
              </div>
            </div>
          )}

          {resultState === "error" && (
            <div className="mm-message" role="status">
              <p className="mm-eyebrow">Actualité de la maison</p>
              <h2>Résultats momentanément indisponibles.</h2>
              <p className="mm-message-copy">
                Un problème de connexion empêche leur affichage. Réessayez dans un instant.
              </p>
              <button className="mm-button" type="button" onClick={retry} disabled={retrying}>
                {retrying ? "Chargement…" : "Réessayer"}
              </button>
            </div>
          )}

          {resultState === "ready" && (
            <div className="mm-results-content">
              <div className="mm-winner-grid">
                {categories.map((category) => (
                  <CategoryPanel key={category.id} category={category} />
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="mm-closing" aria-label="Découvrir Molino Molard">
          <p>Une maison, des métiers, une même attention.</p>
          <span className="mm-closing-note">Molino Molard · Genève</span>
        </section>
        <footer className="mm-footer">
          <span>Une équipe, une maison.</span>
          <span>Genève, Suisse</span>
        </footer>
      </div>
    </main>
  );
}

export default WinnersCelebration;