// cspell:words coderabbitai
//
// Watches a pull request for the fix-issue skill: waits for CodeRabbit to
// finish with the head commit, and later for anything new on the PR (a review
// thread, a reply in one, a review or a comment on the PR) or for the PR to
// merge or close. Each wait prints what it found and exits, so it can run in
// the background and the session hears about it when it's done.
//
//   node .claude/skills/fix-issue/scripts/pr-activity.mts review <pr> [--minutes <n>]
//   node .claude/skills/fix-issue/scripts/pr-activity.mts snapshot <pr> <file>
//   node .claude/skills/fix-issue/scripts/pr-activity.mts wait <pr> <file> [--minutes <n>]
//
// review    Waits until CodeRabbit's check on the PR's head commit has
//           completed, or CodeRabbit has posted a review of that commit.
//           Prints `reviewed <sha> <conclusion>`, `merged` or `closed`, or
//           `timeout` after <n> minutes (default 30).
// snapshot  Writes the ids of every comment and review on the PR to <file>.
// wait      Waits until the PR has a comment or review that isn't in <file>,
//           and prints one line for each: its kind, author, link and first
//           line. Prints `merged` or `closed` if the PR is, and `quiet` after
//           <n> minutes (default 30) with nothing new.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const OWNER = 'Blotch-Smart-Frames';
const NAME = 'AngularLynx';
/** How often to ask GitHub, well inside its rate limit. */
const POLL_MS = 60_000;
/** CodeRabbit's login in GraphQL (REST calls it `coderabbitai[bot]`). */
const CODE_RABBIT_LOGIN = 'coderabbitai';

// One query for everything a wait looks at. A thread's or review's comments
// past the first 100 are left out: no PR here has come near that.
const QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $n) {
    state headRefOid
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) {
      nodes { ... on CheckRun { name status conclusion } } } } } } }
    reviewThreads(first: 100) { nodes { isResolved comments(first: 100) {
      nodes { databaseId url body author { login } } } } }
    reviews(last: 100) { nodes { databaseId url body author { login } commit { oid } } }
    comments(last: 100) { nodes { databaseId url body author { login } } }
  } }
}`;

type Comment = {
  databaseId: number;
  url: string;
  body: string;
  author: { login: string } | null;
};

type Item = {
  /** Unique across kinds: GitHub numbers each kind separately. */
  key: string;
  kind: 'thread' | 'reply' | 'review' | 'comment';
  author: string;
  url: string;
  body: string;
  resolved?: boolean;
};

type PullRequest = {
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  head: string;
  /** CodeRabbit's check run on the head commit, once it has started one. */
  codeRabbitCheck: { status: string; conclusion: string | null } | null;
  /** Whether CodeRabbit has posted a review of the head commit. */
  reviewedHead: boolean;
  items: Item[];
};

const fetchPullRequest = (n: number): PullRequest => {
  const out = execFileSync(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      `query=${QUERY}`,
      '-F',
      `n=${n}`,
      '-f',
      `owner=${OWNER}`,
      '-f',
      `name=${NAME}`,
    ],
    // Node's default buffer is 1 MiB, and a reply past it kills gh, which
    // every poll would then repeat until the deadline. The busiest PR so far
    // (#543: 7 threads, 11 reviews) came to 72 KB, full bodies and all.
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const pr = JSON.parse(out).data.repository.pullRequest;
  if (!pr) throw new Error(`No pull request #${n} in ${OWNER}/${NAME}`);
  const checks: { name?: string; status?: string; conclusion?: string }[] =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const check = checks.find(({ name }) => name === 'CodeRabbit');
  const login = (c: Comment) => c.author?.login ?? 'ghost';
  const items: Item[] = [];
  for (const thread of pr.reviewThreads.nodes) {
    thread.comments.nodes.forEach((c: Comment, i: number) =>
      items.push({
        key: `review-comment:${c.databaseId}`,
        kind: i === 0 ? 'thread' : 'reply',
        author: login(c),
        url: c.url,
        body: c.body,
        resolved: thread.isResolved,
      }),
    );
  }
  for (const r of pr.reviews.nodes as (Comment & {
    commit: { oid: string } | null;
  })[]) {
    // Every reply in a thread comes inside a review of its own with an empty
    // body. The reply is listed above; its review would only repeat it.
    if (!r.body.trim()) continue;
    items.push({
      key: `review:${r.databaseId}`,
      kind: 'review',
      author: login(r),
      url: r.url,
      body: r.body,
    });
  }
  for (const c of pr.comments.nodes as Comment[]) {
    items.push({
      key: `comment:${c.databaseId}`,
      kind: 'comment',
      author: login(c),
      url: c.url,
      body: c.body,
    });
  }
  return {
    state: pr.state,
    head: pr.headRefOid,
    codeRabbitCheck: check
      ? { status: check.status!, conclusion: check.conclusion ?? null }
      : null,
    reviewedHead: (
      pr.reviews.nodes as {
        author: { login: string } | null;
        commit: { oid: string } | null;
      }[]
    ).some(
      (r) =>
        r.author?.login === CODE_RABBIT_LOGIN &&
        r.commit?.oid === pr.headRefOid,
    ),
    items,
  };
};

/** The first line of a body that says something, without markup. */
const firstLine = (body: string): string => {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]/g, '');
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return (line ?? '').slice(0, 140);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks GitHub until `done` returns what to print, or the time runs out. A
 * failed request (the network, a rate limit) is reported and tried again at
 * the next poll rather than ending the wait.
 */
const poll = async (
  n: number,
  minutes: number,
  done: (pr: PullRequest) => string[] | null,
  onTimeout: string,
): Promise<void> => {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    try {
      const pr = fetchPullRequest(n);
      if (pr.state !== 'OPEN') {
        console.log(pr.state.toLowerCase());
        return;
      }
      const lines = done(pr);
      if (lines) {
        for (const line of lines) console.log(line);
        return;
      }
    } catch (error) {
      console.error(`Couldn't read #${n}: ${(error as Error).message}`);
    }
    if (Date.now() >= deadline) {
      console.log(onTimeout);
      return;
    }
    await sleep(Math.min(POLL_MS, deadline - Date.now()));
  }
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { minutes: { type: 'string', default: '30' } },
});
const [command, prArg, file] = positionals;
const n = Number(prArg);
const minutes = Number(values.minutes);
const usage =
  'Usage: node .claude/skills/fix-issue/scripts/pr-activity.mts review <pr> | snapshot <pr> <file> | wait <pr> <file> [--minutes <n>]';
if (!Number.isInteger(n) || !(minutes > 0)) {
  console.error(usage);
  process.exit(1);
}

if (command === 'review') {
  await poll(
    n,
    minutes,
    (pr) => {
      if (pr.codeRabbitCheck?.status === 'COMPLETED') {
        return [`reviewed ${pr.head} ${pr.codeRabbitCheck.conclusion}`];
      }
      if (pr.reviewedHead) return [`reviewed ${pr.head} review`];
      return null;
    },
    'timeout',
  );
} else if (command === 'snapshot' && file) {
  const { items } = fetchPullRequest(n);
  writeFileSync(file, JSON.stringify({ keys: items.map(({ key }) => key) }));
  console.log(`${items.length} comments and reviews on #${n} saved to ${file}`);
} else if (command === 'wait' && file) {
  const seen = new Set<string>(JSON.parse(readFileSync(file, 'utf8')).keys);
  await poll(
    n,
    minutes,
    (pr) => {
      const fresh = pr.items.filter(({ key }) => !seen.has(key));
      if (fresh.length === 0) return null;
      return fresh.map(
        (item) =>
          `${item.kind}${item.resolved ? ' (resolved thread)' : ''} ${item.author} ${item.url} ${firstLine(item.body)}`,
      );
    },
    'quiet',
  );
} else {
  console.error(usage);
  process.exit(1);
}
