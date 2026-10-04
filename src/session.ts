/** Portable v1 contract, mirrored from skills/design-workbench/scripts/serve.py.
 * Author HTML/CSS remains data; the shared sandbox renderer handles preview safety.
 */
export const MAX_BODY_BYTES = 1_500_000;
// Absolute end anchors match Python fullmatch; JavaScript $ also accepts a final newline.
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}(?![\s\S])/;
const COLOR = /^#[0-9a-fA-F]{6}(?![\s\S])/;
const CSS_VAR = /^--[a-z][a-z0-9-]{0,63}(?![\s\S])/;
const ATTRIBUTE = /^data-[a-z][a-z0-9-]{0,63}(?![\s\S])/;
const OPTION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?![\s\S])/;
const BRIEF_KEYS = ['purpose', 'audience', 'platform', 'mood', 'avoid'];
type ObjectValue = Record<string, unknown>;

export interface Variant extends ObjectValue {
  id: string;
  name: string;
  rationale: string;
  html: string;
  css?: string;
  tokens: ObjectValue;
  baselineTokens?: ObjectValue;
  tweaks?: ObjectValue[];
  tweakValues?: ObjectValue;
  baselineTweakValues?: ObjectValue;
  notes?: string;
}
export interface Session extends ObjectValue {
  version: 1;
  id: string;
  title: string;
  brief: ObjectValue;
  variants: Variant[];
  selectedId?: string | null;
  viewport?: { width: number; height: number; preset?: string };
  view?: { mode: 'compare' | 'focus'; activeId: string };
}

export class InvalidInput extends Error {}
function fail(message: string): never { throw new InvalidInput(message); }
export function object(value: unknown, field: string): asserts value is ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
}
function count(value: string): number { return Array.from(value).length; }
export function requiredString(value: unknown, field: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
  if (count(value) > maximum) fail(`${field} is too long`);
}
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function tokens(value: unknown, field: string): void {
  object(value, field);
  if (Object.keys(value).length === 0) return;
  for (const key of ['accent', 'background', 'text']) {
    if (typeof value[key] !== 'string' || !COLOR.test(value[key])) fail(`${field}.${key} must be a hexadecimal color`);
  }
  for (const [key, minimum, maximum] of [['spacing', 0, 128], ['fontSize', 10, 48], ['radius', 0, 32]] as const) {
    if (!number(value[key]) || value[key] < minimum || value[key] > maximum) fail(`${field}.${key} must be between ${minimum} and ${maximum}`);
  }
}
function designer(value: unknown, field: string): void {
  object(value, field);
  requiredString(value.model, `${field}.model`, 128);
  if ('role' in value) requiredString(value.role, `${field}.role`, 128);
}
function tweakValue(value: unknown, definition: ObjectValue, field: string): void {
  let valid = false;
  switch (definition.type) {
    case 'range': valid = number(value) && number(definition.min) && number(definition.max) && value >= definition.min && value <= definition.max; break;
    case 'color': valid = typeof value === 'string' && COLOR.test(value); break;
    case 'toggle': valid = typeof value === 'boolean'; break;
    case 'select': valid = typeof value === 'string' && Array.isArray(definition.options) && definition.options.some((option: ObjectValue) => option.value === value); break;
  }
  if (!valid) fail(`${field} is not a valid ${String(definition.type)} value`);
}
function tweaks(variant: ObjectValue, prefix: string): void {
  const controls = 'tweaks' in variant ? variant.tweaks : [];
  if (!Array.isArray(controls) || controls.length > 24) fail(`${prefix}.tweaks must be an array of at most 24 controls`);
  const byId = new Map<string, ObjectValue>();
  const bindings = new Set<string>();
  for (const [index, control] of controls.entries()) {
    const field = `${prefix}.tweaks[${index}]`;
    object(control, field);
    requiredString(control.id, `${field}.id`, 32);
    if (!ID_PATTERN.test(control.id) || byId.has(control.id)) fail(`${field}.id must be a unique control id`);
    requiredString(control.label, `${field}.label`, 100);
    if (typeof control.type !== 'string' || !['range', 'color', 'select', 'toggle'].includes(control.type)) fail(`${field}.type is unsupported`);
    const hasVar = 'cssVar' in control;
    if (hasVar === ('attribute' in control)) fail(`${field} must bind exactly one cssVar or attribute`);
    const binding = control[hasVar ? 'cssVar' : 'attribute'];
    if (typeof binding !== 'string' || !(hasVar ? CSS_VAR : ATTRIBUTE).test(binding) || bindings.has(binding)) fail(`${field} requires a unique safe binding`);
    bindings.add(binding);
    const unit = 'unit' in control ? control.unit : '';
    if (typeof unit !== 'string' || !['', 'px', 'rem', 'em', '%', 'deg'].includes(unit) || (unit && (control.type !== 'range' || !hasVar))) fail(`${field}.unit is unsupported`);
    if (control.type === 'range') {
      const { min, max } = control;
      const step = 'step' in control ? control.step : 1;
      if (!number(min) || !number(max) || !number(step) || min < -10000 || min >= max || max > 10000 || step <= 0 || step > max - min) fail(`${field} requires finite min < max and a positive step`);
    }
    if (control.type === 'select') {
      if (!Array.isArray(control.options) || control.options.length < 2 || control.options.length > 12) fail(`${field}.options must contain 2 to 12 options`);
      const values = new Set<string>();
      for (const option of control.options) {
        object(option, `${field}.options entry`);
        if (typeof option.value !== 'string' || !OPTION.test(option.value) || values.has(option.value)) fail(`${field}.options require unique safe values`);
        requiredString(option.label, `${field}.options.label`, 100);
        values.add(option.value);
      }
    }
    tweakValue(control.default, control, `${field}.default`);
    byId.set(control.id, control);
  }
  for (const key of ['tweakValues', 'baselineTweakValues']) {
    if (!(key in variant)) continue;
    const values = variant[key];
    object(values, `${prefix}.${key}`);
    for (const [id, value] of Object.entries(values)) {
      const definition = byId.get(id);
      if (!definition) fail(`${prefix}.${key} contains an unknown control`);
      tweakValue(value, definition, `${prefix}.${key}.${id}`);
    }
  }
}

function finiteTree(value: unknown, depth = 0): void {
  if (depth > 80) fail('JSON nesting is too deep');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON numbers must be finite');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child, depth + 1);
}

export function validateSession(value: unknown): Session {
  object(value, 'session');
  finiteTree(value);
  if (value.version !== 1) fail('The library requires portable inline version 1; hydrate source files with the CLI');
  requiredString(value.id, 'id', 128);
  if (!ID_PATTERN.test(value.id)) fail('id contains unsupported characters');
  requiredString(value.title, 'title', 300);
  object(value.brief, 'brief');
  for (const key of BRIEF_KEYS) {
    if (typeof value.brief[key] !== 'string' || count(value.brief[key]) > 5000) fail(`brief.${key} must be a string under 5000 characters`);
  }
  if (!Array.isArray(value.variants) || !value.variants.length || value.variants.length > 12) fail('variants must contain 1 to 12 items');
  const ids = new Set<string>();
  for (const [index, variant] of value.variants.entries()) {
    const field = `variants[${index}]`;
    object(variant, field);
    requiredString(variant.id, `${field}.id`, 32);
    if (!ID_PATTERN.test(variant.id) || ids.has(variant.id)) fail(`${field}.id must be a unique safe id`);
    ids.add(variant.id);
    requiredString(variant.name, `${field}.name`, 300);
    requiredString(variant.rationale, `${field}.rationale`, 5000);
    if ('sources' in variant) fail(`${field}.sources cannot be stored in inline version 1`);
    if (typeof variant.html !== 'string' || count(variant.html) > 300000) fail(`${field}.html must be a string under 300KB`);
    if ('css' in variant && (typeof variant.css !== 'string' || count(variant.css) > 300000)) fail(`${field}.css must be a string under 300KB`);
    const notes = 'notes' in variant ? variant.notes : '';
    if (typeof notes !== 'string' || count(notes) > 20000) fail(`${field}.notes must be a string under 20KB`);
    tokens(variant.tokens, `${field}.tokens`);
    if ('baselineTokens' in variant) tokens(variant.baselineTokens, `${field}.baselineTokens`);
    if ('summary' in variant) requiredString(variant.summary, `${field}.summary`, 300);
    if ('designer' in variant) designer(variant.designer, `${field}.designer`);
    tweaks(variant, field);
  }
  if (value.selectedId !== null && value.selectedId !== undefined && (typeof value.selectedId !== 'string' || !ids.has(value.selectedId))) fail('selectedId must be null or a variant id');
  if ('viewport' in value) {
    object(value.viewport, 'viewport');
    for (const [key, minimum, maximum] of [['width', 240, 2560], ['height', 320, 2160]] as const) {
      const size = value.viewport[key];
      if (!number(size) || !Number.isInteger(size) || size < minimum || size > maximum) fail(`viewport.${key} must be an integer between ${minimum} and ${maximum}`);
    }
    if ('preset' in value.viewport && (typeof value.viewport.preset !== 'string' || !['mobile', 'tablet', 'desktop', 'custom'].includes(value.viewport.preset))) fail('viewport.preset is unsupported');
  }
  if ('view' in value) {
    object(value.view, 'view');
    if (typeof value.view.mode !== 'string' || !['compare', 'focus'].includes(value.view.mode)) fail('view.mode must be compare or focus');
    if (typeof value.view.activeId !== 'string' || !ids.has(value.view.activeId)) fail('view.activeId must be a variant id');
  }
  if ('designer' in value) designer(value.designer, 'designer');
  if ('sample' in value && typeof value.sample !== 'boolean') fail('sample must be a boolean');
  return value as Session;
}

/** Match SessionStore._merge_mutable_state: source, metadata and reset baselines stay authoritative. */
export function mergeMutable(current: Session, incoming: unknown): Session {
  object(incoming, 'state');
  if (incoming.version !== 1) fail('The library requires version 1 browser state');
  if (!Array.isArray(incoming.variants)) fail('variants must contain the existing variant ids');
  const byId = new Map<string, ObjectValue>();
  for (const variant of incoming.variants) {
    object(variant, 'variant');
    if (typeof variant.id !== 'string' || byId.has(variant.id)) fail('variants must contain the existing variant ids');
    byId.set(variant.id, variant);
  }
  if (byId.size !== current.variants.length || current.variants.some((variant) => !byId.has(variant.id))) fail('Variant structure changed; reload before saving');
  const result = structuredClone(current);
  for (const key of ['title', 'brief', 'selectedId', 'viewport', 'view']) if (key in incoming) result[key] = structuredClone(incoming[key]);
  for (const variant of result.variants) {
    const source = byId.get(variant.id)!;
    for (const key of ['tokens', 'tweakValues', 'notes']) if (key in source) variant[key] = structuredClone(source[key]);
  }
  return validateSession(result);
}

export function preview(state: Session) {
  return {
    variant: state.variants.find((variant) => variant.id === state.selectedId)
      ?? state.variants.find((variant) => variant.id === state.view?.activeId)
      ?? state.variants[0],
    viewport: state.viewport ?? { width: 390, height: 760, preset: 'mobile' },
  };
}
