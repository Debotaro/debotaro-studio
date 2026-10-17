// Verifies an explicitly downloaded private model without generating tokens.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.OLLAMA_MODEL ?? 'qwen3.5:4b';
assert.equal(model, 'qwen3.5:4b', 'Only the reviewed model has a recorded digest; review any replacement separately');
const digest = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const probe = `const response=await fetch('http://ollama:11434/api/tags',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Model server not ready');const tags=await response.json();const model=tags.models.find(value=>value.name===${JSON.stringify(model)});if(!model||model.digest!==${JSON.stringify(digest)})throw Error('Reviewed model digest does not match; do not expose AI');console.log(JSON.stringify({model:model.name,digest:model.digest,sizeBytes:model.size,inferenceRequested:false}))`;
const output = execFileSync('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.local-ai.yaml', '--profile', 'local-ai', 'run', '--rm', '--no-deps', 'studio', 'node', '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
process.stdout.write(output);
