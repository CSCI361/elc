import { useAccount } from "@/auth/context"
import { legalDocument, type LegalPage as LegalPageKind } from "./messages"
import "./legal.css"

export function LegalPage({ page }: { page: LegalPageKind }) {
  const { locale } = useAccount()
  const { title, updated, intro, sections } = legalDocument(locale, page)
  return (
    <article className="legal-page">
      <header>
        <h1 className="page-title">{title}</h1>
        <p className="legal-updated">{updated}</p>
        <p className="page-lead">{intro}</p>
      </header>
      {sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.length > 1 ? (
            <ul>
              {section.body.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>{section.body[0]}</p>
          )}
        </section>
      ))}
    </article>
  )
}
