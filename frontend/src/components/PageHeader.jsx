// Shared page header: the page's one <h1>, an optional one-line description, and the page's primary actions, always in the same place
// (title left, actions right; actions wrap under the title on narrow screens). Styles: .page-header* in styles.css.
// Pure presentation: no data, no routing, no permissions. Pass buttons or links as `actions` exactly as the page renders them today.
export default function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {description ? <p className="page-header-desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
