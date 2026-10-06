export function WorkspaceLoading({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      className={fullPage ? 'workspace-loading main' : 'workspace-loading'}
      role="status"
      aria-label="Chargement de votre patrimoine"
      aria-busy="true"
    >
      <span className="loading-label">
        <span className="loading-spinner" aria-hidden="true" />
        Chargement de votre patrimoine…
      </span>
      <div aria-hidden="true" className="loading-content">
        <div className="skeleton skeleton-title" />
        <div className="metrics">
          {[0, 1, 2, 3].map((item) => (
            <div className="panel skeleton skeleton-metric" key={item} />
          ))}
        </div>
        <div className="panel skeleton skeleton-chart" />
        <div className="panel skeleton skeleton-table" />
      </div>
    </div>
  );
}
