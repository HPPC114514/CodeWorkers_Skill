import path from 'node:path';
import os from 'node:os';

export const HARNESSES = ['codex', 'claude-code', 'antigravity', 'opencode', 'pi', 'dsh', 'zcode', 'generic'];
const description = 'Implements a bounded task from the planner, performs permitted validation, and reports blockers without redesigning or delegating the task.';
const scalar = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label} must be a nonempty single-line string`);
  return value.trim();
};
const quote = value => JSON.stringify(value).replaceAll('\x7f', '\\u007f');

export function normalize(input) {
  const requestedHarness = scalar(input.harness, 'harness').toLowerCase();
  const harness = requestedHarness === 'claude' ? 'claude-code' : HARNESSES.includes(requestedHarness) ? requestedHarness : 'generic';
  let model = scalar(input.model, 'model');
  if (['inherit', 'default', 'auto'].includes(model.toLowerCase())) throw new Error('Choose an explicit worker model; inheritance/auto routing is not supported');
  const provider = input.provider === undefined ? undefined : scalar(input.provider, 'provider');
  const effort = input.effort === undefined ? undefined : scalar(input.effort, 'effort');
  const scope = input.scope ?? 'user';
  if (!['user', 'project'].includes(scope)) throw new Error('scope must be user or project');
  if (effort && ['pi', 'antigravity'].includes(harness)) throw new Error(`${harness} adapter has no portable standalone effort field; do not silently ignore effort`);
  if (provider && !['dsh', 'opencode', 'pi', 'generic'].includes(harness)) throw new Error(`${harness} does not accept a separate provider field`);
  if (provider && ['opencode', 'pi'].includes(harness)) {
    if (model.includes('/') && !model.startsWith(`${provider}/`)) throw new Error('model and provider disagree');
    if (!model.includes('/')) model = `${provider}/${model}`;
  }
  if (harness === 'opencode' && !/^[^/]+\/.+/.test(model)) throw new Error('OpenCode needs provider/model');
  if (harness === 'antigravity' && !['flash', 'pro'].includes(model)) throw new Error('Antigravity adapter supports explicit flash or pro model tiers');
  let tools = input.tools;
  if (typeof tools === 'string') tools = tools.split(',').map(x => x.trim());
  if (tools !== undefined && (!Array.isArray(tools) || !tools.length || tools.some(x => typeof x !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(x)))) throw new Error('tools must contain exact nonempty native tool names');
  if (harness === 'antigravity' && !tools?.length) throw new Error('Antigravity requires tools verified against the current runtime');
  if (tools && harness !== 'antigravity') throw new Error('Explicit tools are only used by the Antigravity adapter');
  const profile = input.profile;
  if (harness === 'dsh') {
    if (!provider) throw new Error('DSH requires a concrete LLM provider');
    if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) throw new Error('DSH requires an existing profile name (no path components)');
    if (scope !== 'user') throw new Error('DSH profile installation supports user scope only');
  } else if (profile !== undefined) throw new Error('profile is only supported for DSH');
  return { harness, requestedHarness, model, provider, effort, scope, profile, tools };
}

export function render(opts, prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('worker prompt must not be empty');
  if (opts.harness === 'codex') {
    const fields = { name: 'code_worker', description, model: opts.model };
    if (opts.effort) fields.model_reasoning_effort = opts.effort;
    fields.developer_instructions = prompt;
    return Object.entries(fields).map(([key,value]) => `${key} = ${quote(value)}`).join('\n') + '\n';
  }
  if (opts.harness === 'generic') {
    return `# Portable Code Worker\n\nRequested harness: ${opts.requestedHarness}\n${opts.provider ? `Selected provider: ${opts.provider}\n` : ''}Selected model: ${opts.model}\n${opts.effort ? `Selected effort: ${opts.effort}\n` : ''}\nThis is a portable handoff, not a native agent definition. The planner must verify actual delegation and model controls before dispatch.\n\n${prompt}`;
  }
  if (opts.harness === 'dsh') {
    const agentOptions = { provider: opts.provider, model: opts.model };
    if (opts.effort) agentOptions.reasoningEffort = opts.effort;
    // JSON flow mappings are valid YAML. Keep the outer block sequence appendable.
    const row = { id: 'code-workers-worker', name: '@deepseek-ai/dsh-tool-subagent', config: {
      provider: 'spawn', toolName: 'code_worker', backgroundMode: 'one-shot',
      modelSelectionSettings: false, agentOptions, persona: prompt, maxDepth: 1,
    } };
    return `- insert:\n    - ${quote(row)}\n`;
  }
  const fields = { name: 'code-worker', description, model: opts.model };
  if (opts.harness === 'opencode') { delete fields.name; fields.mode = 'subagent'; }
  if (opts.harness === 'antigravity') { fields.mainAgent = false; fields.subagent = true; fields.tools = opts.tools; }
  if (opts.effort) fields[opts.harness === 'zcode' ? 'thoughtLevel' : opts.harness === 'opencode' ? 'reasoningEffort' : 'effort'] = opts.effort;
  return `---\n${Object.entries(fields).map(([k,v])=>`${k}: ${quote(v)}`).join('\n')}\n---\n${prompt}`;
}

export function targetPath(opts, { home = os.homedir(), cwd = process.cwd(), env = process.env } = {}) {
  const base = opts.scope === 'project' ? path.resolve(cwd) : path.resolve(home);
  const userHome = (key, fallback) => env[key] ? path.resolve(env[key]) : fallback;
  const routes = {
    codex: () => path.join(opts.scope === 'user' ? userHome('CODEX_HOME',path.join(base,'.codex')) : path.join(base,'.codex'),'agents','code_worker.toml'),
    'claude-code': () => path.join(opts.scope === 'user' ? userHome('CLAUDE_CONFIG_DIR',path.join(base,'.claude')) : path.join(base,'.claude'),'agents','code-worker.md'),
    antigravity: () => path.join(base,...(opts.scope === 'user' ? ['.gemini','config','agents'] : ['.agents','agents']),'code-worker.md'),
    opencode: () => path.join(opts.scope === 'user' ? path.join(userHome('XDG_CONFIG_HOME',path.join(base,'.config')),'opencode') : path.join(base,'.opencode'),'agents','code-worker.md'),
    pi: () => path.join(opts.scope === 'user' ? userHome('PI_CODING_AGENT_DIR',path.join(base,'.pi','agent')) : path.join(base,'.pi'),'agents','code-worker.md'),
    zcode: () => { if(opts.scope !== 'user') throw new Error('ZCode only supports user scope'); return path.join(base,'.zcode','agents','code-worker.md'); },
    dsh: () => path.join(userHome('DSH_HOME',path.join(base,'.dsh')),'profiles',opts.profile,'cordis.patch.yml'),
  };
  if (!routes[opts.harness]) throw new Error('generic/unknown harness has no automatic installation target');
  return routes[opts.harness]();
}

const begin = '# BEGIN CODE-WORKERS MANAGED WORKER';
const end = '# END CODE-WORKERS MANAGED WORKER';
export function appendDshPatch(existing, patch, replace = false) {
  // Accept the documented block-sequence dialect only. No YAML evaluation or
  // reserialization: !!js expressions and unrelated comments remain untouched.
  if (/^(?:---|\.\.\.)\s*$/m.test(existing)) throw new Error('DSH multi/document markers are unsupported; preserve the file and stop');
  const block = `${begin}\n${patch}${end}\n`;
  const start = existing.indexOf(begin);
  if (start >= 0) {
    const stop = existing.indexOf(end,start);
    if (stop < 0 || existing.indexOf(begin,start+begin.length)>=0 || existing.indexOf(end,stop+end.length)>=0) throw new Error('Malformed DSH managed block');
    const tail = stop+end.length+(existing[stop+end.length]==='\n'?1:0);
    const previous = existing.slice(start,tail);
    if (previous === block) return existing;
    if (!replace) throw new Error('DSH managed worker conflict; explicit --replace required');
    return existing.slice(0,start)+block+existing.slice(tail);
  }
  if (existing.includes(end) || existing.includes('code-workers-worker')) throw new Error('Unmanaged DSH worker conflict');
  const significant = existing.split(/\r?\n/).find(x => x.trim() && !x.trimStart().startsWith('#'));
  if (significant && !/^- /.test(significant)) throw new Error('DSH patch must be an empty/comment-only file or block sequence; flow sequences are unsupported');
  return existing+(existing && !existing.endsWith('\n')?'\n':'')+block;
}

export function checkPreflight(opts, target, record, now = Date.now()) {
  const fail = message => { throw new Error(`Preflight failed: ${message}; installation stopped`); };
  if (!record || record.schemaVersion !== 1) fail('missing schemaVersion 1 attestation');
  for (const key of ['harness','model','scope','provider','effort','profile']) {
    if ((record[key]??null)!==(opts[key]??null)) fail(`${key} differs from the selected configuration`);
  }
  if (typeof record.target !== 'string' || !path.isAbsolute(record.target) || path.resolve(record.target)!==path.resolve(target)) fail('target differs');
  const checked = Date.parse(record.checkedAt);
  if (!Number.isFinite(checked) || now-checked > 3600000 || checked-now > 60000) fail('observations must be from the last hour');
  const required = ['delegation','modelSelection','definitionFormat'];
  if (opts.effort) required.push('reasoningSelection');
  if (opts.harness === 'pi') required.push('extensionAvailable');
  if (opts.harness === 'antigravity') required.push('toolsMapped');
  if (opts.harness === 'dsh') required.push('existingProfile','spawnProvider','persona','agentOptions','depthLimit','toolPackageAvailable','patchValidated');
  for (const key of required) if (record.capabilities?.[key] !== true) fail(`required capability ${key} is missing or unconfirmed`);
  if (opts.harness === 'antigravity' && JSON.stringify(record.tools)!==JSON.stringify(opts.tools)) fail('tools differ from observed mapping');
  if (opts.harness === 'opencode' && opts.effort && record.reasoningField !== 'reasoningEffort') fail('reasoningField must confirm this provider accepts reasoningEffort');
  if (record.modelAvailable !== true) fail('selected worker model is unavailable or unconfirmed');
  if (!Array.isArray(record.evidence) || !record.evidence.length || record.evidence.some(x=>typeof x!=='string'||!x.trim())) fail('record concrete observations in evidence');
}
