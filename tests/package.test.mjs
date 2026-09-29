import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root=fileURLToPath(new URL('../skills/code-workers/',import.meta.url));
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]); }

test('skill metadata supports discovery and local resource links resolve',()=>{
  const skill=fs.readFileSync(path.join(root,'SKILL.md'),'utf8');
  const metadata=parse(skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
  assert.equal(metadata.name,'code-workers');
  assert.match(metadata.description,/^Use when /);
  assert.ok(skill.split(/\s+/).length<800,'Keep the entrypoint concise');
  const ui=parse(fs.readFileSync(path.join(root,'agents/openai.yaml'),'utf8'));
  assert.equal(ui.policy.allow_implicit_invocation,true);
  for(const file of files(root).filter(x=>x.endsWith('.md'))) {
    for(const match of fs.readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1])),`${file}: missing ${match[1]}`);
    }
  }
});

test('distributed scripts have only built-in or bundled relative imports',()=>{
  for(const file of files(path.join(root,'scripts')).filter(x=>x.endsWith('.mjs'))) {
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) {
      const spec=match[2];
      assert.ok(spec.startsWith('node:')||spec.startsWith('.'),`${file} runtime dependency ${spec}`);
      if(spec.startsWith('.')) assert.ok(fs.existsSync(path.resolve(path.dirname(file),spec)));
    }
  }
});
