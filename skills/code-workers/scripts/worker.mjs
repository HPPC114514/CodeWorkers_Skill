import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { normalize, render, targetPath, appendDshPatch, checkPreflight } from './lib/adapters.mjs';

const usage = `Code Workers (Node.js 20+, no runtime packages)
  node worker.mjs render --harness NAME --model MODEL [options]
  node worker.mjs install --harness NAME --model MODEL --preflight FILE [options]
  node worker.mjs rollback --receipt FILE

Options: --provider ID --effort LEVEL --tools name,name --profile NAME
         --scope user|project (default user) --home DIR --project-root DIR
         --state-dir DIR --replace
DSH render: --merge-profile reads the existing profile and previews the full patch.
render prints the definition only; redirect stdout to save an offline artifact.
install requires current, configuration-bound observations from the host planner.
The script does not discover live tools, install dependencies, or call model APIs.
After install, verify native discovery in a fresh session. On failure, rollback.
See ../references/setup.md for the attestation format and capability checks.
`;

function parse(argv) {
  const [command,...args]=argv;
  if (!command || command==='--help' || command==='help') return {command:'help'};
  if (!['render','install','rollback'].includes(command)) throw new Error('Expected render, install, or rollback');
  const values=new Set(['harness','model','provider','effort','scope','profile','tools','home','project-root','state-dir','preflight','receipt']);
  const flags=new Set(['replace','merge-profile']);
  const result={command};
  for(let i=0;i<args.length;i++) {
    const key=args[i].startsWith('--')?args[i].slice(2):'';
    if(!values.has(key)&&!flags.has(key)) throw new Error(`Unknown option: ${args[i]}`);
    if(Object.hasOwn(result,key)) throw new Error(`Duplicate option: --${key}`);
    if(flags.has(key)) result[key]=true;
    else {
      if(i+1===args.length||args[i+1].startsWith('--')) throw new Error(`Missing value: --${key}`);
      result[key]=args[++i];
    }
  }
  if(command==='rollback') {
    if(!result.receipt||Object.keys(result).some(k=>!['command','receipt'].includes(k))) throw new Error('rollback requires only --receipt FILE');
  } else if(result.receipt) throw new Error('--receipt is only valid for rollback');
  if(command==='install'&&result['merge-profile']) throw new Error('--merge-profile is only valid for render');
  if(command==='render'&&(result.preflight||result['state-dir'])) throw new Error('render does not accept installation options');
  return result;
}

async function main() {
  const input=parse(process.argv.slice(2));
  if(input.command==='help') {process.stdout.write(usage);return;}
  if(input.command==='rollback') {
    const {rollback}=await import('./lib/transaction.mjs');
    process.stdout.write(JSON.stringify(await rollback(path.resolve(input.receipt)),null,2)+'\n');return;
  }
  const opts=normalize(input);
  const home=path.resolve(input.home??os.homedir());
  const cwd=path.resolve(input['project-root']??process.cwd());
  const prompt=fs.readFileSync(new URL('../assets/worker-prompt.md',import.meta.url),'utf8');
  const fragment=render(opts,prompt);
  if(input['merge-profile']&&opts.harness!=='dsh') throw new Error('--merge-profile is only valid for DSH');
  if(input.command==='render'&&!input['merge-profile']) {process.stdout.write(fragment);return;}
  const target=targetPath(opts,{home,cwd});
  let content=fragment;
  let expectedOriginalHash;
  if(opts.harness==='dsh') {
    const profileDir=path.dirname(target);
    if(!fs.existsSync(path.join(profileDir,'package.json'))) throw new Error('DSH requires an existing initialized profile; no profile will be created');
    if(!fs.existsSync(target)) throw new Error('DSH profile patch is missing; installation stopped');
    const original=fs.readFileSync(target);
    const decoded=original.toString('utf8');
    if (!Buffer.from(decoded,'utf8').equals(original)) throw new Error('DSH patch must be valid UTF-8; original bytes preserved, installation stopped');
    expectedOriginalHash=createHash('sha256').update(original).digest('hex');
    content=appendDshPatch(decoded,fragment,Boolean(input.replace));
  }
  if(input.command==='render') {process.stdout.write(content);return;}
  if(!input.preflight) throw new Error('Preflight observations are required (--preflight FILE); no files installed');
  const record=JSON.parse(fs.readFileSync(path.resolve(input.preflight),'utf8'));
  checkPreflight(opts,target,record);
  if(opts.harness==='dsh'&&record.candidateSha256!==createHash('sha256').update(content).digest('hex')) throw new Error('Preflight failed: DSH candidateSha256 must match the validated full patch');
  const {installFiles}=await import('./lib/transaction.mjs');
  const result=await installFiles({files:[{path:target,content,...(expectedOriginalHash===undefined?{}:{expectedOriginalHash})}],stateDir:path.resolve(input['state-dir']??path.join(home,'.code-workers','transactions')),
    // Appending a dedicated DSH row is the requested first installation; updating
    // an existing managed row still needs explicit --replace in appendDshPatch.
    replace:opts.harness==='dsh'||Boolean(input.replace)});
  process.stdout.write(JSON.stringify({...result,harness:opts.harness,model:opts.model,
    verification:'Configuration bytes checked; native discovery and execution are not verified. Start a fresh session; rollback this receipt if native checks fail.'},null,2)+'\n');
}

try { await main(); }
catch(error) { process.stderr.write(`code-workers: ${error.message}\n`); process.exitCode=1; }
