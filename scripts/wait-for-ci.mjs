// Deployment gate: public read-only GitHub API, no credentials or secret logging.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
assert.match(sha, /^[a-f0-9]{40}$/);
if (process.env.WORKERS_CI === '1') {
  assert.equal(process.env.WORKERS_CI_COMMIT_SHA, sha, 'Build checkout differs from Cloudflare trigger');
  assert.equal(process.env.WORKERS_CI_BRANCH, 'main', 'Only main may deploy to production');
}
const api = async path => {
  const response = await globalThis.fetch(`https://api.github.com/repos/Debotaro/debotaro-studio/${path}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'debotaro-studio-deployment-gate' }, signal: globalThis.AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Public CI verification unavailable (${response.status}); deployment refused.`);
  return response.json();
};
const deadline = Date.now() + 15 * 60 * 1000;
let accepted = false;
while (Date.now() < deadline) {
  const value = await api(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=10`);
  const run = value.workflow_runs?.filter(item => item.head_sha === sha && item.head_branch === 'main' && item.event === 'push').sort((a, b) => b.id - a.id)[0];
  if (run?.status === 'completed') {
    assert.equal(run.conclusion, 'success', 'Exact-source verification failed; production deployment refused.');
    const main = await api('git/ref/heads/main');
    assert.equal(main.object?.sha, sha, 'A newer main commit exists; stale build must not deploy.');
    process.stdout.write(`Exact-source CI passed: ${run.html_url}\n`); accepted = true; break;
  }
  process.stdout.write(`Waiting for exact-source CI at ${sha.slice(0, 12)} (${run?.status ?? 'not yet scheduled'})\n`);
  await delay(30000);
}
assert.equal(accepted, true, 'CI gate timed out; production deployment refused.');
