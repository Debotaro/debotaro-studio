import { useEffect, useId, useState } from 'react';
import { catalog, type PropRule } from '../core/document';
import type { StudioNode, JsonValue } from '../core/types';

const propertyLabels: Record<string, string> = {
  ariaLabel: 'Accessibility label',
  hidden: 'Hidden',
  visibleWhen: 'Show when',
  background: 'Background',
  border: 'Border color',
  radius: 'Corner radius',
  shadow: 'Shadow',
  text: 'Text',
  color: 'Color',
  size: 'Font size',
  weight: 'Font weight',
  variant: 'Variant',
  label: 'Label',
  disabled: 'Disabled',
  placeholder: 'Placeholder',
  type: 'Input type',
  required: 'Required',
  options: 'Options',
  tone: 'Tone',
  columns: 'Table columns',
  emptyMessage: 'Empty state message',
  title: 'Title',
  subtitle: 'Subtitle',
};

const conditionLabels: Record<string, string> = {
  always: 'Always',
  hasSelection: 'Ticket selected',
  hasResults: 'Matching tickets',
  empty: 'No matching tickets',
  loading: 'Loading tickets',
  error: 'Loading error',
  ready: 'Tickets loaded',
  'tab:inbox': 'Inbox tab',
  'tab:activity': 'Activity tab',
  'tab:customer': 'Customer tab',
};

const propertyGroups = ['Content', 'Appearance', 'Behavior', 'Accessibility'] as const;
type PropertyGroup = typeof propertyGroups[number];

function propertyGroup(name: string): PropertyGroup {
  if (name === 'ariaLabel') return 'Accessibility';
  if (['hidden', 'visibleWhen', 'disabled', 'required'].includes(name)) return 'Behavior';
  if (['background', 'border', 'radius', 'shadow', 'color', 'size', 'weight', 'variant', 'tone'].includes(name)) return 'Appearance';
  return 'Content';
}

function propertyHelp(name: string, rule: PropRule): string | undefined {
  if (name === 'ariaLabel') return 'Screen reader label. Leave blank to use the component’s default name.';
  if (name === 'visibleWhen') return 'Show this layer when an app condition is met. Test conditions in Preview.';
  if (name === 'hidden') return 'Hide this layer in both Design and Preview.';
  if (rule.kind === 'options') return 'Use a JSON list of label/value pairs, for example [{"label":"Open","value":"open"}].';
  if (rule.kind === 'columns') return `Use a JSON list of column names: ${rule.values?.join(', ')}. Their order sets the table order.`;
  if (rule.kind === 'color') return 'Use a supported color or a color token such as $semantic.accent.';
  if (rule.kind === 'number') return `Use ${rule.min}–${rule.max}${name === 'weight' ? ' in steps of 100' : ''}, or a numeric token reference.`;
  return undefined;
}

export function ComponentProperties({ node, onChange }: { node: StudioNode; onChange: (props: StudioNode['props']) => void }) {
  const set = (name: string, value: JsonValue | undefined) => {
    const props = { ...node.props };
    if (value === undefined) delete props[name];
    else props[name] = value;
    onChange(props);
  };
  const properties = Object.entries(catalog[node.type].props);
  return <>{propertyGroups.map(group => {
    const grouped = properties.filter(([name]) => propertyGroup(name) === group);
    return grouped.length > 0 && <div className="inspector-property-group" role="group" aria-label={`${group} properties`} key={group}>
      <h4>{group}</h4>
      {grouped.map(([name, rule]) => <PropertyInput key={`${node.id}:${name}`} name={name} rule={rule} value={node.props[name]} onChange={value => set(name, value)} />)}
    </div>;
  })}</>;
}

function PropertyInput({ name, rule, value, onChange }: { name: string; rule: PropRule; value: JsonValue | undefined; onChange: (value: JsonValue | undefined) => void }) {
  const json = rule.kind === 'options' || rule.kind === 'columns';
  const source = json ? JSON.stringify(value ?? [], null, 2) : String(value ?? '');
  const [draft, setDraft] = useState(source), [error, setError] = useState('');
  const id = useId();
  const help = propertyHelp(name, rule);
  const description = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const label = propertyLabels[name] ?? name;
  useEffect(() => { setDraft(source); setError(''); }, [source]);
  const commit = () => {
    if (source === draft) return;
    try {
      onChange(draft === '' ? undefined : json ? JSON.parse(draft) as JsonValue : rule.kind === 'number' && !draft.startsWith('$') ? Number(draft) : draft);
      setDraft(source);
      setError('');
    } catch {
      setError(json ? 'Enter valid JSON for this property.' : 'Enter a number or a numeric token reference.');
    }
  };
  return <div className="property-field">
    {rule.kind === 'boolean' ? <label className="check-field">
      <input aria-label={name} aria-describedby={description} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
      <span className="property-name">{label}</span>
    </label> : rule.kind === 'enum' ? <label className="edit-field">
      <span className="property-name">{label}</span>
      <select aria-label={name} aria-describedby={description} value={String(value ?? '')} onChange={event => onChange(event.target.value || undefined)}>
        <option value="">Default</option>
        {rule.values?.map(option => <option value={option} key={option}>{name === 'visibleWhen' ? conditionLabels[option] ?? option : option}</option>)}
      </select>
    </label> : <label className={json ? 'stacked-field' : 'edit-field'}>
      <span className="property-name">{label}{json ? ' (JSON)' : ''}</span>
      {json ? <textarea aria-label={`${name} JSON`} aria-describedby={description} aria-invalid={error ? true : undefined} value={draft} rows={4} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commit} /> : <input aria-label={name} aria-describedby={description} aria-invalid={error ? true : undefined} value={draft} placeholder="Default" onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
    </label>}
    {help && <p className="property-help" id={`${id}-help`}>{help}</p>}
    {error && <p className="error" id={`${id}-error`} role="alert">{error}</p>}
  </div>;
}
