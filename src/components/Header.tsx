interface HeaderProps {
  title: string;
  onBack?: () => void;
}

export function Header({ title, onBack }: HeaderProps) {
  return (
    <header className="screen-header">
      {onBack && (
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          ‹
        </button>
      )}
      <h1 className="screen-title">{title}</h1>
    </header>
  );
}

interface StatCellProps {
  value: string;
  label: string;
}

export function StatCell({ value, label }: StatCellProps) {
  return (
    <div className="stat-cell">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function StatGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="stat-grid">
      {rows.map(([label, value], i) => (
        <StatCell key={i} value={value} label={label} />
      ))}
    </div>
  );
}
