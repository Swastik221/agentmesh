export interface PlaceholderPageProps {
  title: string;
}

/** Stand-in for sections that have not been built yet. */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="app-placeholder">
      <span className="app-placeholder__title">{title}</span>
      <span className="app-placeholder__note">
        Section reserved. The workspace canvas lives under Overview.
      </span>
    </div>
  );
}
