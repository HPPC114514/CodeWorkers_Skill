import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as yaml } from 'yaml';
import { parse as toml } from 'smol-toml';
import path from 'node:path';
import { render, normalize, targetPath, appendDshPatch, checkPreflight } from '../skills/code-workers/scripts/lib/adapters.mjs';

const prompt = '# Worker\n中文 "quote" \\ backslash\nC:\\Users\\demo\n\'\'\' triple\n\u007f';
const markdown = text => {
  const end = text.indexOf('\n---\n', 4);
  return { header: yaml(text.slice(4, end)), body: text.slice(end + 5) };
};

for (const harness of ['codex', 'claude-code', 'antigravity', 'opencode', 'pi', 'dsh', 'zcode', 'generic']) {
  test(`${harness}: parse generated config and preserve prompt`, () => {
    const opts = normalize({ harness, model: harness === 'antigravity' ? 'flash' : 'vendor/economy',
      provider: harness === 'dsh' ? 'vendor' : undefined, profile: harness === 'dsh' ? 'web' : undefined,
      tools: harness === 'antigravity' ? ['view_file', 'replace_file_content', 'run_command'] : undefined });
    const text = render(opts, prompt);
    if (harness === 'codex') {
      const data = toml(text);
      assert.equal(data.developer_instructions, prompt);
      assert.equal(data.model, opts.model);
      assert.equal(data.name, 'code_worker');
    } else if (harness === 'dsh') {
      const data = yaml(text)[0].insert[0];
      assert.equal(data.config.persona, prompt);
      assert.deepEqual(data.config.agentOptions, { provider: 'vendor', model: 'vendor/economy' });
      assert.equal(data.config.provider, 'spawn');
      assert.equal(data.config.toolName, 'code_worker');
      assert.equal(data.config.modelSelectionSettings, false);
    } else if (harness === 'generic') {
      assert.ok(text.includes(prompt));
      assert.ok(text.includes('vendor/economy'));
    } else {
      const { header, body } = markdown(text);
      assert.equal(body, prompt);
      assert.equal(header.model, opts.model);
      if (harness === 'opencode') assert.equal(header.mode, 'subagent');
      else assert.equal(header.name, 'code-worker');
    }
  });
}

test('effort uses supported native field and unsupported values fail', () => {
  assert.equal(toml(render(normalize({harness:'codex',model:'economy',effort:'medium'}), prompt)).model_reasoning_effort, 'medium');
  assert.equal(markdown(render(normalize({harness:'claude-code',model:'haiku',effort:'low'}), prompt)).header.effort, 'low');
  assert.equal(markdown(render(normalize({harness:'zcode',model:'economy',effort:'high'}), prompt)).header.thoughtLevel, 'high');
  assert.equal(markdown(render(normalize({harness:'opencode',model:'openai/economy',effort:'low'}), prompt)).header.reasoningEffort, 'low');
  for (const harness of ['pi','antigravity']) {
    assert.throws(() => normalize({harness,model:'flash',effort:'high'}), /effort/i);
  }
  for (const model of ['', 'inherit', 'default', 'x\ny']) assert.throws(() => normalize({harness:'codex',model}));
});

test('OpenCode effort requires observed provider field compatibility', () => {
  const opts=normalize({harness:'opencode',model:'openai/economy',effort:'low'});
  const target=path.resolve('fixture.md');
  const record={schemaVersion:1,checkedAt:new Date().toISOString(),harness:'opencode',model:opts.model,effort:'low',scope:'user',target,
    capabilities:{delegation:true,modelSelection:true,definitionFormat:true,reasoningSelection:true},modelAvailable:true,evidence:['Synthetic compatible provider fixture']};
  assert.throws(()=>checkPreflight(opts,target,record), /reasoningField/);
  assert.doesNotThrow(()=>checkPreflight(opts,target,{...record,reasoningField:'reasoningEffort'}));
});

test('model names remain configurable, never silently mapped to an expensive default', () => {
  assert.equal(normalize({harness:'claude-code',model:'my-custom-model'}).model, 'my-custom-model');
  assert.throws(() => normalize({harness:'antigravity',model:'gpt-6-luna'}), /flash|pro/);
  assert.throws(() => normalize({harness:'dsh',model:'economy',provider:'vendor',profile:'../escape'}));
});

test('unknown harness retains the selected provider without inventing a route format', () => {
  const output=render(normalize({harness:'nebula',provider:'vendor-a',model:'economy'}),prompt);
  assert.ok(output.includes('Selected provider: vendor-a\n'));
  assert.ok(output.includes('Selected model: economy\n'));
  assert.ok(!output.includes('vendor-a/economy'));
});

test('native paths honor explicit scope and home, no unknown target guessing', () => {
  const home = path.resolve('fixture-home');
  const cwd = path.resolve('fixture-project');
  assert.equal(targetPath(normalize({harness:'codex',model:'economy'}), {home,cwd,env:{}}), path.join(home,'.codex','agents','code_worker.toml'));
  assert.equal(targetPath(normalize({harness:'pi',model:'economy',scope:'project'}), {home,cwd,env:{}}), path.join(cwd,'.pi','agents','code-worker.md'));
  assert.throws(() => targetPath(normalize({harness:'zcode',model:'economy',scope:'project'}), {home,cwd,env:{}}), /scope/);
  assert.throws(() => targetPath(normalize({harness:'nebula',model:'economy'}), {home,cwd,env:{}}), /generic|unknown/i);
});

test('DSH append preserves prior bytes and replaces only the managed block explicitly', () => {
  const prior = '# 用户配置\r\n- id: unrelated\r\n  config: {x: 1}\r\n';
  const patch = '- insert:\n    - id: code-workers-worker\n      name: example\n';
  const added = appendDshPatch(prior, patch);
  assert.ok(added.startsWith(prior));
  assert.equal(yaml(added)[0].id, 'unrelated');
  assert.equal(appendDshPatch(added, patch), added);
  assert.throws(() => appendDshPatch(added, patch+'# change\n'), /conflict/i);
  const updated = appendDshPatch(added, patch+'# change\n', true);
  assert.ok(updated.startsWith(prior));
  assert.equal((updated.match(/BEGIN CODE-WORKERS/g)||[]).length, 1);
  assert.throws(() => appendDshPatch('[]\n', patch), /sequence|empty/i);
  assert.throws(() => appendDshPatch('---\n- id: other\n...\n', patch), /document/i);
});

test('preflight binds current capabilities to exact target and model before installation', () => {
  const opts=normalize({harness:'codex',model:'economy'});
  const target=path.resolve('fixture-home/.codex/agents/code_worker.toml');
  const evidence={schemaVersion:1,checkedAt:new Date().toISOString(),harness:'codex',model:'economy',scope:'user',target,
    capabilities:{delegation:true,modelSelection:true,definitionFormat:true},modelAvailable:true,
    evidence:['Observed native spawn tool and custom agent schema; model resolved in current model list.']};
  assert.doesNotThrow(()=>checkPreflight(opts,target,evidence));
  for(const change of [{model:'other'},{modelAvailable:false},{capabilities:{delegation:false}},{evidence:[]},{checkedAt:'2000-01-01T00:00:00Z'}]) {
    assert.throws(()=>checkPreflight(opts,target,{...evidence,...change}));
  }
});

test('packaged prompt contains original verbatim and only adds the worker recursion boundary', () => {
  const original=readFileSync(new URL('../code-worker-system-prompt.md',import.meta.url),'utf8').replaceAll('\r\n','\n').trimEnd();
  const asset=readFileSync(new URL('../skills/code-workers/assets/worker-prompt.md',import.meta.url),'utf8');
  assert.ok(asset.startsWith(original));
  assert.ok(asset.slice(original.length).includes('Do not spawn'));
});
