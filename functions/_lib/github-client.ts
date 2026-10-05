// publish_generated_image（MCP tool）がGitHubへ書き込むための最小限のGit Data APIクライアント。
// `gh` CLI（scripts/lib/github-pr.mjsが使う方式）はWorkersランタイムにサブプロセスが
// 存在しないため使えない。ここではfetchベースでREST/Git Data APIを直接呼ぶ。
//
// 認証は2方式に対応する:
// - GITHUB_TOKEN（fine-grained PAT等）をそのままBearerとして使う（既定・最小構成）
// - GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID が揃っていれば、
//   JWT署名 → installation access token 発行の順で短命トークンを取得する（より権限を絞れる）
// どちらを使うかはresolveGitHubToken()が解決する。

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubAppCredentials {
  appId: string;
  privateKeyPem: string;
  installationId: string;
}

export class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

const GITHUB_API_BASE = 'https://api.github.com';

async function githubFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'hobnova-mcp-cover-publish',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return res;
}

async function githubJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await githubFetch(token, path, init);
  if (!res.ok) {
    // GitHubのエラーレスポンスにはrequest URLやdocumentation_urlが含まれることがあるが、
    // messageだけを使い、秘密情報やスタックトレースを呼び出し元へ伝播させない。
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string };
      detail = body.message ?? '';
    } catch {
      // ignore
    }
    throw new GitHubApiError(`GitHub API ${path} failed: ${res.status}${detail ? ` ${detail}` : ''}`, res.status);
  }
  return res.json() as Promise<T>;
}

// --- GitHub App JWT → installation token ---

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** GitHub App識別用のJWT（RS256、10分間有効）を署名する。 */
async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  // GitHubの時刻ズレ要求に合わせ、iatを60秒過去にずらす。
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };

  const encoder = new TextEncoder();
  const headerPart = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerPart}.${payloadPart}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${signaturePart}`;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

async function getInstallationToken(creds: GitHubAppCredentials): Promise<string> {
  const jwt = await signAppJwt(creds.appId, creds.privateKeyPem);
  const res = await fetch(`${GITHUB_API_BASE}/app/installations/${creds.installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'hobnova-mcp-cover-publish',
    },
  });
  if (!res.ok) {
    throw new GitHubApiError(`Failed to obtain GitHub App installation token: ${res.status}`, res.status);
  }
  const body = (await res.json()) as InstallationTokenResponse;
  return body.token;
}

export interface GitHubAuthEnv {
  GITHUB_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
}

/**
 * 認証トークンを解決する。GitHub App認証情報が3つとも揃っていればそちらを優先し
 * （より権限を絞れるため）、揃っていなければGITHUB_TOKEN（PAT）を使う。
 * どちらも無ければエラーを投げる。
 */
export async function resolveGitHubToken(env: GitHubAuthEnv): Promise<string> {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID) {
    return getInstallationToken({
      appId: env.GITHUB_APP_ID,
      privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
    });
  }
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  throw new Error('No GitHub credentials configured (GITHUB_TOKEN or GITHUB_APP_*)');
}

// --- Git Data API ---

export interface GitRefResponse {
  object: { sha: string };
}

export async function getBranchHeadSha(token: string, repo: GitHubRepoRef, branch: string): Promise<string> {
  const data = await githubJson<GitRefResponse>(
    token,
    `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return data.object.sha;
}

export interface GitCommitResponse {
  sha: string;
  tree: { sha: string };
}

export async function getCommit(token: string, repo: GitHubRepoRef, sha: string): Promise<GitCommitResponse> {
  return githubJson<GitCommitResponse>(token, `/repos/${repo.owner}/${repo.repo}/git/commits/${sha}`);
}

export interface ContentsResponse {
  sha: string;
  content: string; // base64, 改行含む
  encoding: string;
}

/** 指定refでのファイル内容を取得する。存在しなければnullを返す（404を例外にしない）。 */
export async function getFileContents(
  token: string,
  repo: GitHubRepoRef,
  path: string,
  ref: string
): Promise<ContentsResponse | null> {
  const res = await githubFetch(
    token,
    `/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to read ${path}: ${res.status}`, res.status);
  return res.json() as Promise<ContentsResponse>;
}

export async function createBlob(token: string, repo: GitHubRepoRef, base64Content: string): Promise<string> {
  const data = await githubJson<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
  });
  return data.sha;
}

export async function createRef(token: string, repo: GitHubRepoRef, ref: string, sha: string): Promise<void> {
  await githubJson(token, `/repos/${repo.owner}/${repo.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${ref}`, sha }),
  });
}

export interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string | null; // nullでそのpathを削除する
}

export async function createTree(
  token: string,
  repo: GitHubRepoRef,
  baseTreeSha: string,
  entries: TreeEntry[]
): Promise<string> {
  const data = await githubJson<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  return data.sha;
}

export async function createCommitObject(
  token: string,
  repo: GitHubRepoRef,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string> {
  const data = await githubJson<{ sha: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  return data.sha;
}

export async function updateRef(token: string, repo: GitHubRepoRef, ref: string, sha: string): Promise<void> {
  await githubJson(token, `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${ref}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha, force: false }),
  });
}

/** branch作成後の途中失敗時に後片付けするためのdelete。失敗しても例外を投げない（呼び出し元はbest-effort扱い）。 */
export async function deleteRefSilently(token: string, repo: GitHubRepoRef, ref: string): Promise<void> {
  try {
    await githubFetch(token, `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${ref}`, { method: 'DELETE' });
  } catch {
    // best-effort。孤立branchが残っても実害は無いため、ここでの失敗は呼び出し元へ伝播させない。
  }
}

export interface CreatePullRequestInput {
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface PullRequestResponse {
  number: number;
  html_url: string;
  mergeable: boolean | null;
}

export async function createPullRequest(
  token: string,
  repo: GitHubRepoRef,
  input: CreatePullRequestInput
): Promise<PullRequestResponse> {
  return githubJson<PullRequestResponse>(token, `/repos/${repo.owner}/${repo.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
