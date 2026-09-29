import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const cli=fileURLToPath(new URL('../skills/code-workers/scripts/worker.mjs',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,CODEX_HOME:'',DSH_HOME:'',PI_CODING_AGENT_DIR:''}});
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'code-workers-cli-'));
  t.after(()=>{assert.ok(path.basename(dir).startsWith('code-workers-cli-')); assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir())); fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}
test('CLI render needs no runtime or attestation; malformed options fail',()=>{
  const result=run('render','--harness','codex','--model','economy');
  assert.equal(result.status,0,result.stderr); assert.ok(result.stdout.includes('developer_instructions'));
  assert.notEqual(run('render','--harness','codex','--model','inherit').status,0);
  assert.notEqual(run('render','--harness','codex','--model','economy','--typo','x').status,0);
  assert.notEqual(run('render','--harness','codex','--model','economy','--model','other').status,0);
});
test('install without runtime observations makes no target files',t=>{
  const home=fixture(t);
  const result=run('install','--harness','codex','--model','economy','--home',home);
  assert.notEqual(result.status,0); assert.deepEqual(fs.readdirSync(home),[]);
});
test('CLI install, unchanged install, conflict and explicit rollback',t=>{
  const home=fixture(t), target=path.join(home,'.codex','agents','code_worker.toml');
  const evidence=path.join(home,'preflight.json');
  fs.writeFileSync(evidence,JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),harness:'codex',model:'economy',scope:'user',target,
    capabilities:{delegation:true,modelSelection:true,definitionFormat:true},modelAvailable:true,evidence:['Simulated fixture: known native schema and model routing.']}));
  const args=['install','--harness','codex','--model','economy','--home',home,'--preflight',evidence];
  const result=run(...args); assert.equal(result.status,0,result.stderr);
  const installed=JSON.parse(result.stdout); assert.equal(installed.status,'installed_pending_reload');
  assert.ok(fs.readFileSync(target,'utf8').includes('Do not spawn'));
  assert.equal(JSON.parse(run(...args).stdout).status,'unchanged');
  const reverted=run('rollback','--receipt',installed.receipt); assert.equal(reverted.status,0,reverted.stderr);
  assert.equal(fs.existsSync(target),false);
});
test('unknown harness may render a portable prompt but installation stops',t=>{
  const home=fixture(t);
  assert.equal(run('render','--harness','nebula','--model','economy').status,0);
  assert.notEqual(run('install','--harness','nebula','--model','economy','--home',home).status,0);
  assert.deepEqual(fs.readdirSync(home),[]);
});

test('missing Pi extension and unavailable model stop before writes',t=>{
  const home=fixture(t), target=path.join(home,'.pi','agent','agents','code-worker.md');
  const evidence=path.join(home,'preflight.json');
  const record={schemaVersion:1,checkedAt:new Date().toISOString(),harness:'pi',model:'vendor/economy',scope:'user',target,
    capabilities:{delegation:true,modelSelection:true,definitionFormat:true},modelAvailable:true,evidence:['Synthetic fixture']};
  const args=['install','--harness','pi','--model',record.model,'--home',home,'--preflight',evidence];
  fs.writeFileSync(evidence,JSON.stringify(record));
  assert.match(run(...args).stderr,/extensionAvailable/);
  record.capabilities.extensionAvailable=true; record.modelAvailable=false;
  fs.writeFileSync(evidence,JSON.stringify(record));
  assert.match(run(...args).stderr,/model is unavailable/);
  assert.deepEqual(fs.readdirSync(home),['preflight.json']);
});

test('DSH merges one existing profile, binds candidate and restores original bytes',t=>{
  const home=fixture(t), profile=path.join(home,'.dsh','profiles','existing');
  fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'package.json'),'{}');
  const target=path.join(profile,'cordis.patch.yml');
  const prior=Buffer.from('# 用户配置\r\n- id: existing\r\n  config: {path: "C:\\\\Users\\\\demo"}\r\n');
  fs.writeFileSync(target,prior);
  const args=['--harness','dsh','--model','economy','--provider','vendor','--profile','existing','--home',home];
  const rendered=run('render',...args,'--merge-profile');
  assert.equal(rendered.status,0,rendered.stderr);
  const record={schemaVersion:1,checkedAt:new Date().toISOString(),harness:'dsh',model:'economy',provider:'vendor',profile:'existing',scope:'user',target,
    capabilities:Object.fromEntries(['delegation','modelSelection','definitionFormat','existingProfile','spawnProvider','persona','agentOptions','depthLimit','toolPackageAvailable','patchValidated'].map(k=>[k,true])),
    modelAvailable:true,evidence:['Synthetic existing-profile fixture'],candidateSha256:'wrong'};
  const evidence=path.join(home,'preflight.json');
  fs.writeFileSync(evidence,JSON.stringify(record));
  assert.match(run('install',...args,'--preflight',evidence).stderr,/candidateSha256/);
  assert.deepEqual(fs.readFileSync(target),prior);
  record.candidateSha256=createHash('sha256').update(rendered.stdout).digest('hex');
  fs.writeFileSync(evidence,JSON.stringify(record));
  const installed=run('install',...args,'--preflight',evidence);
  assert.equal(installed.status,0,installed.stderr);
  assert.ok(fs.readFileSync(target).subarray(0,prior.length).equals(prior));
  assert.equal(JSON.parse(run('install',...args,'--preflight',evidence).stdout).status,'unchanged');
  const restored=run('rollback','--receipt',JSON.parse(installed.stdout).receipt);
  assert.equal(restored.status,0,restored.stderr);
  assert.deepEqual(fs.readFileSync(target),prior);
  assert.equal(fs.readFileSync(path.join(profile,'package.json'),'utf8'),'{}');
  fs.writeFileSync(target,Buffer.from([0xff,0xfe]));
  assert.match(run('render',...args,'--merge-profile').stderr,/UTF-8/);
  assert.deepEqual(fs.readFileSync(target),Buffer.from([0xff,0xfe]));
});
