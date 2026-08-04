import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  headingId,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  headingId: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading page-heading--system">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={headingId}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  );
}
