import { kitMessages, type Locale } from './i18n';
import { ID_PATTERN, InvalidInput, MAX_BODY_BYTES, object, requiredString, validateSession, type Session, type Variant } from './session';

export interface KitToken {
  name: string;
  type: 'color' | 'dimension' | 'number' | 'fontFamily';
  value: string | number;
  description: string;
}
export interface KitSource { designId: string; variantId: string; revision: string }
export interface KitExample {
  id: string; name: string; kind: 'screen' | 'component'; source: KitSource;
  variant: Variant; viewport: NonNullable<Session['viewport']>;
}
export interface KitContent {
  formatVersion: 1; name: string; description: string;
  tokens: KitToken[]; rules: string; examples: KitExample[];
}
export interface KitVersion {
  kitId: string; version: number; createdAt: string; summary: string; content: KitContent;
}
const TOKEN_NAME = /^[a-z][a-z0-9-]{0,63}(?![\s\S])/;
const REVISION = /^[0-9a-f]{32}(?![\s\S])/;
const DECIMAL = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?';
const NUMBER = new RegExp(`^${DECIMAL}(?![\\s\\S])`);
const DIMENSION = new RegExp(`^${DECIMAL}(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|deg|s|ms)(?![\\s\\S])`);
const COLOR = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|currentcolor|black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|navy|teal|olive|maroon|lime|aqua|silver|fuchsia)(?![\s\S])/i;
const FAMILY = /^(?:[\p{L}_][\p{L}\p{N}_ -]*|"[\p{L}\p{N}_ -]+"|'[\p{L}\p{N}_ -]+')(?![\s\S])/u;
const blankBrief = { purpose: '', audience: '', platform: '', mood: '', avoid: '' };

function textValue(value: unknown, field: string, limit: number): asserts value is string {
  if (typeof value !== 'string' || Array.from(value).length > limit) throw new InvalidInput(`${field} must be a string under ${limit} characters`);
}
export function kitId(value: unknown, field = 'kitId'): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new InvalidInput(`${field} must be a valid id`);
  return value;
}
export function kitVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new InvalidInput('version must be a positive integer');
  return value;
}
export function validateSource(value: unknown): KitSource {
  object(value, 'source');
  const designId = kitId(value.designId, 'source.designId');
  const variantId = kitId(value.variantId, 'source.variantId');
  if (typeof value.revision !== 'string' || !REVISION.test(value.revision)) throw new InvalidInput('source.revision must be the current design revision');
  return { designId, variantId, revision: value.revision };
}
/** Deliberately accepts scalar CSS only. Functions, escapes, URLs and declarations are not tokens. */
export function validateToken(value: unknown): KitToken {
  object(value, 'token');
  if (typeof value.name !== 'string' || !TOKEN_NAME.test(value.name)) throw new InvalidInput('token.name must be a dashed CSS identifier without --');
  textValue(value.description, 'token.description', 1000);
  const scalar = value.value;
  let valid = false;
  if (typeof scalar === 'string' && scalar.length > 300) throw new InvalidInput('token.value is too long');
  switch (value.type) {
    case 'color': valid = typeof scalar === 'string' && COLOR.test(scalar); break;
    case 'dimension': valid = scalar === 0 || (typeof scalar === 'string' && (scalar === '0' || DIMENSION.test(scalar)) && Math.abs(parseFloat(scalar)) <= 1_000_000); break;
    case 'number': valid = (typeof scalar === 'number' || (typeof scalar === 'string' && NUMBER.test(scalar))) && Number.isFinite(Number(scalar)) && Math.abs(Number(scalar)) <= 1_000_000; break;
    case 'fontFamily': valid = typeof scalar === 'string' && scalar.split(',').every((family) => FAMILY.test(family.trim())); break;
  }
  if (!valid) throw new InvalidInput(`token ${value.name} requires a safe ${String(value.type)} scalar value`);
  return { name: value.name, type: value.type as KitToken['type'], value: scalar as string | number, description: value.description };
}
export function validateKitContent(value: unknown): KitContent {
  object(value, 'content');
  if (value.formatVersion !== 1) throw new InvalidInput('Kit content requires formatVersion 1');
  requiredString(value.name, 'content.name', 300);
  textValue(value.description, 'content.description', 5000);
  textValue(value.rules, 'content.rules', 50000);
  if (!Array.isArray(value.tokens) || !value.tokens.length || value.tokens.length > 128) throw new InvalidInput('content.tokens must contain 1 to 128 tokens');
  const tokens = value.tokens.map(validateToken);
  if (new Set(tokens.map((token) => token.name)).size !== tokens.length) throw new InvalidInput('Token names must be unique');
  if (!Array.isArray(value.examples) || !value.examples.length || value.examples.length > 24) throw new InvalidInput('content.examples must contain 1 to 24 examples');
  const examples = value.examples.map((example): KitExample => {
    object(example, 'example');
    const id = kitId(example.id, 'example.id');
    requiredString(example.name, 'example.name', 300);
    if (example.kind !== 'screen' && example.kind !== 'component') throw new InvalidInput('example.kind must be screen or component');
    const source = validateSource(example.source);
    const checked = validateSession({ version: 1, id: 'kit-example', title: 'Kit example', brief: blankBrief, variants: [example.variant], viewport: example.viewport });
    if (checked.variants[0].id !== source.variantId) throw new InvalidInput('Example variant id must match its source variantId');
    return { id, name: example.name, kind: example.kind, source, variant: structuredClone(checked.variants[0]), viewport: structuredClone(checked.viewport!) };
  });
  if (new Set(examples.map((example) => example.id)).size !== examples.length) throw new InvalidInput('Example ids must be unique');
  const content: KitContent = { formatVersion: 1, name: value.name.trim(), description: value.description, tokens, rules: value.rules, examples };
  if (new TextEncoder().encode(JSON.stringify(content)).byteLength > MAX_BODY_BYTES - 2048) throw new InvalidInput('Kit content is too large');
  return content;
}

export function tokensFromVariant(variant: Variant, language: Locale = 'ja'): KitToken[] {
  const descriptions: Record<string, string> = kitMessages[language];
  const tokens: KitToken[] = ['accent', 'background', 'text', 'spacing', 'fontSize', 'radius'].filter((name) => Object.hasOwn(variant.tokens, name)).map((name) => ({
    name: name === 'fontSize' ? 'font-size' : name,
    type: ['accent', 'background', 'text'].includes(name) ? 'color' : 'dimension',
    value: ['accent', 'background', 'text'].includes(name) ? String(variant.tokens[name]) : `${variant.tokens[name]}px`,
    description: descriptions[name],
  }));
  for (const control of variant.tweaks ?? []) {
    if (typeof control.cssVar !== 'string') continue;
    const value = variant.tweakValues && Object.hasOwn(variant.tweakValues, String(control.id)) ? variant.tweakValues[String(control.id)] : control.default;
    const name = control.cssVar.slice(2);
    let candidate: unknown;
    if (control.type === 'range') candidate = { name, type: control.unit ? 'dimension' : 'number', value: control.unit ? `${value}${control.unit}` : value, description: control.label };
    else if (control.type === 'color') candidate = { name, type: 'color', value, description: control.label };
    else if (control.type === 'select' && name.endsWith('font-family')) candidate = { name, type: 'fontFamily', value, description: control.label };
    else if (control.type === 'select' && typeof value === 'string') {
      if (COLOR.test(value)) candidate = { name, type: 'color', value, description: control.label };
      else if (DIMENSION.test(value)) candidate = { name, type: 'dimension', value, description: control.label };
      else if (NUMBER.test(value)) candidate = { name, type: 'number', value, description: control.label };
    }
    if (!candidate) continue;
    const token = validateToken(candidate);
    const index = tokens.findIndex((item) => item.name === name);
    if (index >= 0) tokens[index] = token;
    else tokens.push(token);
  }
  return tokens;
}
export function preparedContent(name: unknown, examples: KitExample[], language: Locale = 'ja'): KitContent {
  return validateKitContent({
    formatVersion: 1, name: name ?? kitMessages[language].newKit, description: '',
    tokens: tokensFromVariant(examples[0].variant, language), examples,
    rules: kitMessages[language].rules,
  });
}
export function tokenStyles(tokens: KitToken[]): string {
  return `:root {\n${tokens.map((token) => `  --${token.name}: ${token.value};`).join('\n')}\n}\n`;
}
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const jsonScript = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const jsonFile = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** One portable bundle contract is used by the browser and CLI. Author HTML never becomes an outer document. */
export async function exportKit(version: KitVersion, runtime: string, legacyCss: string, language: Locale = 'ja') {
  const messages = kitMessages[language];
  const { content } = version;
  const files: { path: string; content: string }[] = [
    { path: 'kit.json', content: jsonFile({ format: 'codex-design-kit', ...version }) },
    { path: 'tokens.css', content: tokenStyles(content.tokens) },
  ];
  const tokenGuide = content.tokens.map((token) => `- \`--${token.name}\` (${token.type}): \`${token.value}\` — ${token.description}`).join('\n');
  const exampleGuide = content.examples.map((example) => `- ${example.name} (${example.kind}): [${messages.preview}](examples/${example.id}/preview.html) · [${messages.source}](examples/${example.id}/variant.json)\n  ${messages.provenance}: design ${example.source.designId}, variant ${example.source.variantId}, revision ${example.source.revision}`).join('\n');
  files.push({ path: 'GUIDE.md', content: `# ${content.name}\n\nVersion ${version.version} · Kit ${version.kitId}\n\n${content.description}\n\n${content.rules}\n\n## ${messages.tokens}\n\n${tokenGuide}\n\n## ${messages.examples}\n\n${exampleGuide}\n\n${messages.guide}\n` });
  for (const example of content.examples) {
    const script = `${runtime.replace(/<\/script/gi, '<\\/script')}\n(() => { const example = ${jsonScript(example)}; const tokens = ${jsonScript(content.tokens)}; const frame = document.querySelector('iframe'); frame.width = example.viewport.width; frame.height = example.viewport.height; frame.srcdoc = window.DesignPreview.frameDocument(example.variant, ${jsonScript(legacyCss)}, tokens); })();`;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)));
    const hash = btoa(String.fromCharCode(...digest));
    const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; frame-src 'self'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'`;
    files.push({ path: `examples/${example.id}/variant.json`, content: jsonFile(example) });
    files.push({ path: `examples/${example.id}/preview.html`, content: `<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(example.name)} — ${escapeHtml(content.name)} v${version.version}</title><style>html{color:#252833;background:#e9e9e9;font-family:system-ui}body{margin:24px}h1{font-size:18px;font-weight:500}p{font-size:13px}iframe{display:block;border:0;background:white;max-width:100%}</style></head><body><h1>${escapeHtml(example.name)}</h1><p>${escapeHtml(content.name)} · v${version.version} · ${example.viewport.width} × ${example.viewport.height}</p><iframe sandbox="" title="${escapeHtml(example.name)}"></iframe><script>${script}</script></body></html>\n` });
  }
  return { filename: `design-kit-${version.kitId}-v${version.version}.json`, files };
}
