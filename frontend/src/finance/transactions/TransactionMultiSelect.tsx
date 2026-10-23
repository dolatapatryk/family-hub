export interface TransactionMultiSelectOption {
  value: string
  label: string
}

export function TransactionMultiSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  options: TransactionMultiSelectOption[]
  value: string[]
  onChange: (values: string[]) => void
}) {
  const selected = new Set(value)
  return <details className="transaction-multiselect">
    <summary aria-label={`${label}: ${value.length ? `${value.length} wybrane` : placeholder}`}>
      <span>{label}</span>
      <strong>{value.length ? `${value.length} wybrane` : placeholder}</strong>
    </summary>
    <div className="transaction-multiselect-options" role="group" aria-label={label}>
      {options.length === 0 && <p>Brak dostępnych pozycji.</p>}
      {options.map(option => <label key={option.value}>
        <input
          type="checkbox"
          checked={selected.has(option.value)}
          onChange={event => onChange(event.target.checked
            ? [...value, option.value]
            : value.filter(selectedValue => selectedValue !== option.value))}
        />
        <span>{option.label}</span>
      </label>)}
      {value.length > 0 && <button type="button" className="button-quiet" onClick={() => onChange([])}>Wyczyść wybór</button>}
    </div>
  </details>
}
