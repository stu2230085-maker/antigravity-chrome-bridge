#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_REPO = 'stu2230085-maker/antigravity-chrome-bridge';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const HELP_TEXT = `agent-discussions — Multi-Agent GitHub Discussions CLI (Antigravity Chrome Bridge)

Usage:
  node scripts/agent-discussions.mjs <command> [options]

Commands:
  categories
      List Discussion categories (id, name, slug, description).

  list [--limit <N>] [--category <nameOrSlug>]
      List recent Discussions (number, title, category, author, updatedAt, commentsCount, url).

  view <number>
      Display a Discussion's full body and all comments/replies in clean Markdown.

  create --category <nameOrSlug> --title <title> [--model <modelName>] [--role <roleName>] (--body <text> | --body-file <path>)
      Create a new Discussion (prepends standardized Model/Role/Commit header when --model is set).

  reply <number> [--model <modelName>] [--role <roleName>] [--reply-to <commentId>] (--body <text> | --body-file <path>)
      Post a comment (or threaded reply) to Discussion <number>.

Global Options:
  -R, --repo <owner/name>   Target GitHub repository (default: ${DEFAULT_REPO} or $AGB_GITHUB_REPO)
      --json                Print raw JSON output
  -h, --help                Show this help message

Examples:
  node scripts/agent-discussions.mjs categories
  node scripts/agent-discussions.mjs list --limit 10
  node scripts/agent-discussions.mjs view 1
  node scripts/agent-discussions.mjs create --category Ideas --title "ADR: Session Pinning" \\
    --model "Antigravity" --role "Implementer" --body-file /tmp/adr.md
  node scripts/agent-discussions.mjs reply 1 \\
    --model "Claude Opus" --role "Architecture & Security Reviewer" --body-file /tmp/review.md`;

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function parseRepoSlug(rawRepo) {
  const slug = (rawRepo || '').trim();
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliUsageError(
      `Invalid repository "${slug}". Expected "<owner>/<name>" (e.g. "${DEFAULT_REPO}").`,
    );
  }
  return { owner: parts[0], name: parts[1], fullName: `${parts[0]}/${parts[1]}` };
}

function parseDiscussionNumber(rawValue) {
  if (!rawValue) {
    throw new CliUsageError('Missing Discussion <number> argument.');
  }
  const normalized = String(rawValue).trim().replace(/^#/, '');
  if (!/^\d+$/.test(normalized)) {
    throw new CliUsageError(
      `Invalid Discussion number "${rawValue}". Expected a positive integer.`,
    );
  }
  const num = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new CliUsageError(
      `Invalid Discussion number "${rawValue}". Expected a positive integer.`,
    );
  }
  return num;
}

function getShortCommitSha() {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || 'unknown';
  } catch {
    return 'unknown';
  }
}

function readMessageBody({ body, bodyFile }) {
  if (body !== undefined && bodyFile !== undefined) {
    throw new CliUsageError('Specify either --body <text> or --body-file <path>, not both.');
  }
  if (body === undefined && bodyFile === undefined) {
    throw new CliUsageError('Missing message body. Provide --body <text> or --body-file <path>.');
  }

  const content =
    bodyFile !== undefined
      ? bodyFile === '-'
        ? readFileSync(0, 'utf8')
        : readFileSync(bodyFile, 'utf8')
      : body;

  const trimmed = content.trim();
  if (!trimmed) {
    throw new CliUsageError('Message body cannot be empty.');
  }
  return trimmed;
}

function formatAgentBody(rawBody, { model, role, commit }) {
  const modelName = model?.trim();
  if (!modelName) {
    return rawBody;
  }
  if (rawBody.startsWith('> **Model**:')) {
    return rawBody;
  }
  const roleName = role?.trim() || 'Agent';
  const shortSha = commit?.trim() || getShortCommitSha();
  const header = `> **Model**: ${modelName} | **Role**: ${roleName} | **Commit**: ${shortSha}`;
  return `${header}\n\n${rawBody}`;
}

function runGraphql(query, variables = {}) {
  const payload = JSON.stringify({ query, variables });
  let stdout;
  try {
    stdout = execFileSync('gh', ['api', 'graphql', '--input', '-'], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err && err.stderr
        ? String(err.stderr).trim()
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(`gh api graphql failed: ${stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Failed to parse GraphQL JSON response from gh CLI.`);
  }

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const details = parsed.errors.map((e) => e.message || JSON.stringify(e)).join('; ');
    throw new Error(`GitHub GraphQL error: ${details}`);
  }

  return parsed.data;
}

function fetchRepoCategories(owner, name) {
  const query = `
    query RepoDiscussionCategories($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        hasDiscussionsEnabled
        discussionCategories(first: 50) {
          nodes {
            id
            name
            slug
            description
          }
        }
      }
    }
  `;
  const data = runGraphql(query, { owner, name });
  const repo = data?.repository;
  if (!repo) {
    throw new Error(`Repository "${owner}/${name}" not found.`);
  }
  if (!repo.hasDiscussionsEnabled) {
    throw new Error(
      `GitHub Discussions are disabled on "${owner}/${name}". Enable Discussions in repository settings first.`,
    );
  }
  return {
    repositoryId: repo.id,
    categories: repo.discussionCategories?.nodes ?? [],
  };
}

function resolveCategory(categories, queryValue) {
  const needle = queryValue.trim().toLowerCase();
  const matched = categories.find(
    (cat) =>
      cat.slug.toLowerCase() === needle ||
      cat.name.toLowerCase() === needle ||
      cat.id === queryValue.trim(),
  );
  if (!matched) {
    const available = categories.map((c) => `${c.slug} ("${c.name}")`).join(', ');
    throw new CliUsageError(
      `Unknown Discussion category "${queryValue}". Available categories: ${available || 'none'}`,
    );
  }
  return matched;
}

function escapeTableCell(text) {
  return String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function cmdCategories(repo, asJson) {
  const { categories } = fetchRepoCategories(repo.owner, repo.name);
  if (asJson) {
    console.log(JSON.stringify(categories, null, 2));
    return;
  }

  console.log(`# Discussion Categories (${repo.fullName})\n`);
  if (categories.length === 0) {
    console.log('_No categories found._');
    return;
  }

  console.log('| Slug | Name | ID | Description |');
  console.log('| :--- | :--- | :--- | :--- |');
  for (const cat of categories) {
    console.log(
      `| \`${escapeTableCell(cat.slug)}\` | ${escapeTableCell(cat.name)} | \`${escapeTableCell(cat.id)}\` | ${escapeTableCell(cat.description)} |`,
    );
  }
}

function cmdList(repo, options) {
  const rawLimit = options.limit !== undefined ? Number.parseInt(options.limit, 10) : 20;
  if (Number.isNaN(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new CliUsageError(`Invalid --limit "${options.limit}". Expected an integer in 1..100.`);
  }

  let categoryId = null;
  if (options.category) {
    const { categories } = fetchRepoCategories(repo.owner, repo.name);
    categoryId = resolveCategory(categories, options.category).id;
  }

  const query = `
    query ListDiscussions($owner: String!, $name: String!, $limit: Int!, $categoryId: ID) {
      repository(owner: $owner, name: $name) {
        hasDiscussionsEnabled
        discussions(
          first: $limit
          categoryId: $categoryId
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            number
            title
            url
            updatedAt
            author {
              login
            }
            category {
              name
              slug
            }
            comments {
              totalCount
            }
          }
        }
      }
    }
  `;

  const data = runGraphql(query, {
    owner: repo.owner,
    name: repo.name,
    limit: rawLimit,
    categoryId,
  });

  const repoNode = data?.repository;
  if (!repoNode?.hasDiscussionsEnabled) {
    throw new Error(`GitHub Discussions are disabled on "${repo.fullName}".`);
  }

  const items = (repoNode.discussions?.nodes ?? []).map((d) => ({
    number: d.number,
    title: d.title,
    category: d.category?.name ?? 'Uncategorized',
    categorySlug: d.category?.slug ?? '',
    author: d.author?.login ?? 'ghost',
    updatedAt: d.updatedAt,
    commentsCount: d.comments?.totalCount ?? 0,
    url: d.url,
  }));

  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  console.log(
    `# Recent Discussions (${repo.fullName}, showing ${items.length}/${repoNode.discussions?.totalCount ?? 0})\n`,
  );
  if (items.length === 0) {
    console.log('_No Discussions found._');
    return;
  }

  console.log('| # | Title | Category | Author | Comments | Updated | URL |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const item of items) {
    console.log(
      `| #${item.number} | ${escapeTableCell(item.title)} | ${escapeTableCell(item.category)} | @${escapeTableCell(item.author)} | ${item.commentsCount} | ${item.updatedAt} | ${item.url} |`,
    );
  }
}

function cmdView(repo, numberArg, asJson) {
  const number = parseDiscussionNumber(numberArg);
  const query = `
    query ViewDiscussion($owner: String!, $name: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        discussion(number: $number) {
          id
          number
          title
          url
          createdAt
          updatedAt
          body
          author {
            login
          }
          category {
            name
            slug
          }
          comments(first: 100, after: $after) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              url
              createdAt
              body
              author {
                login
              }
              replies(first: 100) {
                totalCount
                nodes {
                  id
                  url
                  createdAt
                  body
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let discussion = null;
  const allComments = [];
  let after = null;

  for (;;) {
    const data = runGraphql(query, {
      owner: repo.owner,
      name: repo.name,
      number,
      after,
    });
    const node = data?.repository?.discussion;
    if (!node) {
      throw new Error(`Discussion #${number} not found in "${repo.fullName}".`);
    }
    if (!discussion) {
      discussion = node;
    }
    const pageComments = node.comments?.nodes ?? [];
    allComments.push(...pageComments);
    if (node.comments?.pageInfo?.hasNextPage && node.comments.pageInfo.endCursor) {
      after = node.comments.pageInfo.endCursor;
    } else {
      break;
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ...discussion,
          comments: {
            totalCount: discussion.comments?.totalCount ?? allComments.length,
            nodes: allComments,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const author = discussion.author?.login ?? 'ghost';
  const categoryName = discussion.category?.name ?? 'Uncategorized';
  console.log(`# Discussion #${discussion.number}: ${discussion.title}\n`);
  console.log(
    `- **Category**: ${categoryName} (\`${discussion.category?.slug ?? ''}\`)\n` +
      `- **Author**: @${author}\n` +
      `- **Created**: ${discussion.createdAt} | **Updated**: ${discussion.updatedAt}\n` +
      `- **URL**: ${discussion.url}\n`,
  );
  console.log('---\n');
  console.log(discussion.body?.trim() || '_No description provided._');
  console.log('\n---\n');
  console.log(`## Comments (${allComments.length})\n`);

  if (allComments.length === 0) {
    console.log('_No comments yet._');
    return;
  }

  for (let i = 0; i < allComments.length; i++) {
    const comment = allComments[i];
    const cAuthor = comment.author?.login ?? 'ghost';
    console.log(
      `### Comment #${i + 1} — @${cAuthor} (${comment.createdAt}) [\`${comment.id}\`](${comment.url})\n`,
    );
    console.log(comment.body?.trim() || '');
    console.log('');

    const replies = comment.replies?.nodes ?? [];
    for (const reply of replies) {
      const rAuthor = reply.author?.login ?? 'ghost';
      console.log(
        `#### ↳ Reply — @${rAuthor} (${reply.createdAt}) [\`${reply.id}\`](${reply.url})\n`,
      );
      console.log(reply.body?.trim() || '');
      console.log('');
    }
  }
}

function cmdCreate(repo, options) {
  if (!options.category?.trim()) {
    throw new CliUsageError('Missing required --category <nameOrSlug> option.');
  }
  if (!options.title?.trim()) {
    throw new CliUsageError('Missing required --title <title> option.');
  }

  const rawBody = readMessageBody({ body: options.body, bodyFile: options.bodyFile });
  const finalBody = formatAgentBody(rawBody, {
    model: options.model,
    role: options.role,
    commit: options.commit,
  });

  const { repositoryId, categories } = fetchRepoCategories(repo.owner, repo.name);
  const category = resolveCategory(categories, options.category);

  const mutation = `
    mutation CreateAgentDiscussion(
      $repositoryId: ID!
      $categoryId: ID!
      $title: String!
      $body: String!
    ) {
      createDiscussion(
        input: {
          repositoryId: $repositoryId
          categoryId: $categoryId
          title: $title
          body: $body
        }
      ) {
        discussion {
          id
          number
          title
          url
        }
      }
    }
  `;

  const data = runGraphql(mutation, {
    repositoryId,
    categoryId: category.id,
    title: options.title.trim(),
    body: finalBody,
  });

  const created = data?.createDiscussion?.discussion;
  if (!created) {
    throw new Error('Failed to create Discussion: empty GraphQL mutation result.');
  }

  if (options.json) {
    console.log(JSON.stringify(created, null, 2));
    return;
  }

  console.log(`Created Discussion #${created.number}: ${created.url}`);
}

function cmdReply(repo, numberArg, options) {
  const number = parseDiscussionNumber(numberArg);
  const rawBody = readMessageBody({ body: options.body, bodyFile: options.bodyFile });
  const finalBody = formatAgentBody(rawBody, {
    model: options.model,
    role: options.role,
    commit: options.commit,
  });

  const lookupQuery = `
    query LookupDiscussionNodeId($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        discussion(number: $number) {
          id
          number
          title
          url
        }
      }
    }
  `;
  const lookupData = runGraphql(lookupQuery, {
    owner: repo.owner,
    name: repo.name,
    number,
  });
  const discussion = lookupData?.repository?.discussion;
  if (!discussion) {
    throw new Error(`Discussion #${number} not found in "${repo.fullName}".`);
  }

  const mutation = `
    mutation AddAgentDiscussionComment($discussionId: ID!, $body: String!, $replyToId: ID) {
      addDiscussionComment(
        input: {
          discussionId: $discussionId
          body: $body
          replyToId: $replyToId
        }
      ) {
        comment {
          id
          url
          createdAt
        }
      }
    }
  `;

  const data = runGraphql(mutation, {
    discussionId: discussion.id,
    body: finalBody,
    replyToId: options.replyTo?.trim() || null,
  });

  const comment = data?.addDiscussionComment?.comment;
  if (!comment) {
    throw new Error('Failed to post Discussion comment: empty GraphQL mutation result.');
  }

  if (options.json) {
    console.log(JSON.stringify({ discussionNumber: number, ...comment }, null, 2));
    return;
  }

  console.log(`Posted comment on Discussion #${number}: ${comment.url}`);
}

function main(argv, env = process.env) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: 'string', short: 'R' },
      limit: { type: 'string' },
      category: { type: 'string' },
      title: { type: 'string' },
      model: { type: 'string' },
      role: { type: 'string' },
      commit: { type: 'string' },
      body: { type: 'string' },
      'body-file': { type: 'string' },
      'reply-to': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command || command === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  const repoSlug = values.repo || env.AGB_GITHUB_REPO || DEFAULT_REPO;
  const repo = parseRepoSlug(repoSlug);

  switch (command) {
    case 'categories':
      cmdCategories(repo, Boolean(values.json));
      break;
    case 'list':
      cmdList(repo, {
        limit: values.limit,
        category: values.category,
        json: Boolean(values.json),
      });
      break;
    case 'view':
      cmdView(repo, positionals[1], Boolean(values.json));
      break;
    case 'create':
      cmdCreate(repo, {
        category: values.category,
        title: values.title,
        model: values.model,
        role: values.role,
        commit: values.commit,
        body: values.body,
        bodyFile: values['body-file'],
        json: Boolean(values.json),
      });
      break;
    case 'reply':
      cmdReply(repo, positionals[1], {
        model: values.model,
        role: values.role,
        commit: values.commit,
        body: values.body,
        bodyFile: values['body-file'],
        replyTo: values['reply-to'],
        json: Boolean(values.json),
      });
      break;
    default:
      throw new CliUsageError(
        `Unknown command "${command}". Expected one of: categories, list, view, create, reply.`,
      );
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliUsageError) {
    console.error(`Error: ${err.message}\n\nRun with --help for usage.`);
    process.exit(1);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
