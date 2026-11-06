import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useExchangeGitHubOAuthCode, useGetGitHubOAuthConfig } from '@workspace/api-client-react';
import {
  Activity, AlertCircle, AlertTriangle, Check, CheckCheck, ChevronDown,
  CircleDot, Clock3, Code2, GitPullRequest, Github, Layers3, LoaderCircle, LogOut,
  MessageSquare, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal,
  Tag, X, XCircle,
} from 'lucide-react';

const queryClient = new QueryClient();
const GH = 'https://api.github.com';
const repoPrefKey = (login: string) => `octotriage.${login}.repo-selection.v1`;
const boardPrefKey = (login: string) => `octotriage.${login}.board-preferences.v1`;

type GitHubUser = { login: string; name: string | null; avatar_url: string };
type GitHubRepo = {
  id: number; full_name: string; owner: { login: string }; name: string; description: string | null;
  private: boolean; updated_at: string;
};
type Label = { id: number; name: string; color: string };
type TriageItem = {
  id: number; number: number; title: string; html_url: string; state: string; updated_at: string;
  created_at: string; comments: number; user: { login: string; avatar_url: string };
  author_association?: string;
  labels: Label[]; assignees: { login: string; avatar_url: string }[];
  pull_request?: { url: string; merged_at?: string | null; draft?: boolean };
  requested_reviewers?: { login: string; avatar_url: string }[];
  repository: { owner: string; name: string; full_name: string };
};
type ApiFault = Error & { status?: number; remaining?: string; resetAt?: string };
type SectionKey = 'incoming' | 'review' | 'stale' | 'blocked';
type BoardPrefs = { kind: 'all' | 'issues' | 'prs'; sort: 'updated' | 'created' | 'comments'; contributor: 'all' | 'first-time' };
const boardCache = new Map<string, { savedAt: number; items: TriageItem[] }>();
const BOARD_CACHE_TTL = 2 * 60 * 1000;

const groupInfo: Record<SectionKey, { title: string; eyebrow: string; detail: string; icon: typeof CircleDot; color: string }> = {
  incoming: { title: 'Incoming', eyebrow: 'UNASSIGNED', detail: 'Needs an owner', icon: CircleDot, color: 'text-[#a96335]' },
  review: { title: 'Needs review', eyebrow: 'PULL REQUESTS', detail: 'Ready for a second look', icon: GitPullRequest, color: 'text-[#507d68]' },
  stale: { title: 'Stale alert', eyebrow: '7+ DAYS QUIET', detail: 'No activity in over a week', icon: Clock3, color: 'text-[#a77a28]' },
  blocked: { title: 'Action blocked', eyebrow: 'WAITING', detail: 'Blocked or waiting on author', icon: AlertTriangle, color: 'text-[#a64f47]' },
};

function getSavedSelection(login: string): number[] {
  try { return JSON.parse(localStorage.getItem(repoPrefKey(login)) || '[]') as number[]; } catch { return []; }
}
function getSavedPrefs(login: string): BoardPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(boardPrefKey(login)) || '{}') as Partial<BoardPrefs>;
    return {
      kind: parsed.kind === 'issues' || parsed.kind === 'prs' ? parsed.kind : 'all',
      sort: parsed.sort === 'created' || parsed.sort === 'comments' ? parsed.sort : 'updated',
      contributor: parsed.contributor === 'first-time' ? 'first-time' : 'all',
    };
  } catch { return { kind: 'all', sort: 'updated', contributor: 'all' }; }
}
function daysSince(value: string) { return (Date.now() - new Date(value).getTime()) / 86400000; }
function relativeDate(value: string) {
  const days = Math.floor(daysSince(value));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
function isPullRequest(item: TriageItem) { return Boolean(item.pull_request); }
function isFirstTimeContributor(item: TriageItem) {
  return item.author_association === 'FIRST_TIMER' || item.author_association === 'FIRST_TIME_CONTRIBUTOR';
}
function isBlocked(item: TriageItem) {
  return item.labels.some((label) => /blocked|waiting[- ]on[- ]author|waiting for author/i.test(label.name));
}
function classify(item: TriageItem, currentLogin: string): SectionKey {
  if (isBlocked(item)) return 'blocked';
  if (daysSince(item.updated_at) > 7) return 'stale';
  if (
    isPullRequest(item) &&
    ((item.requested_reviewers?.length ?? 0) > 0 ||
      (Boolean(currentLogin) && item.user?.login !== currentLogin))
  ) return 'review';
  return 'incoming';
}
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item);
    }
  }));
  return results;
}
function labelColor(hex: string) {
  const value = parseInt(hex || 'd8d2c6', 16);
  const r = (value >> 16) & 255; const g = (value >> 8) & 255; const b = value & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return { backgroundColor: `#${hex || 'd8d2c6'}22`, color: luminance > 0.72 ? '#514a41' : `#${hex || 'd8d2c6'}` };
}

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string };
    const fault = new Error(data.message || `GitHub returned ${response.status}`) as ApiFault;
    fault.status = response.status;
    fault.remaining = response.headers.get('X-RateLimit-Remaining') || undefined;
    const reset = response.headers.get('X-RateLimit-Reset');
    fault.resetAt = reset ? new Date(Number(reset) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined;
    throw fault;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function githubPages<T>(token: string, path: string): Promise<T[]> {
  const endpoint = new URL(path, GH);
  endpoint.searchParams.set('per_page', '100');
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    endpoint.searchParams.set('page', String(page));
    const current = await githubRequest<T[]>(token, `${endpoint.pathname}${endpoint.search}`);
    all.push(...current);
    if (current.length < 100) return all;
  }
}

function AppHome() {
  const configQuery = useGetGitHubOAuthConfig();
  const exchange = useExchangeGitHubOAuthCode();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [items, setItems] = useState<TriageItem[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [prefs, setPrefs] = useState<BoardPrefs>({ kind: 'all', sort: 'updated', contributor: 'all' });
  const [search, setSearch] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fetchingAccount, setFetchingAccount] = useState(false);
  const [fetchingItems, setFetchingItems] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [boardError, setBoardError] = useState<ApiFault | null>(null);
  const [notice, setNotice] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const [oauthError, setOauthError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);

  const selectedRepos = useMemo(() => repos.filter((repo) => selectedRepoIds.includes(repo.id)), [repos, selectedRepoIds]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (prefs.kind === 'issues' && isPullRequest(item)) return false;
      if (prefs.kind === 'prs' && !isPullRequest(item)) return false;
      if (prefs.contributor === 'first-time' && !isFirstTimeContributor(item)) return false;
      if (!needle) return true;
      return `${item.title} ${item.repository.full_name} #${item.number} ${item.user.login} ${item.labels.map((l) => l.name).join(' ')}`.toLowerCase().includes(needle);
    }).sort((a, b) => prefs.sort === 'created' ? Date.parse(b.created_at) - Date.parse(a.created_at) : prefs.sort === 'comments' ? b.comments - a.comments : Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [items, prefs, search]);

  useEffect(() => {
    if (!user?.login) return;
    localStorage.setItem(repoPrefKey(user.login), JSON.stringify(selectedRepoIds));
  }, [selectedRepoIds, user]);
  useEffect(() => {
    if (!user?.login) return;
    localStorage.setItem(boardPrefKey(user.login), JSON.stringify(prefs));
  }, [prefs, user]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const oauthFailure = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (oauthFailure) {
      setOauthError(oauthFailure);
      url.searchParams.delete('error'); url.searchParams.delete('error_description'); url.searchParams.delete('state');
      window.history.replaceState({}, '', url.toString());
      return;
    }
    if (!code) return;
    const expectedState = sessionStorage.getItem('octotriage.oauth-state');
    sessionStorage.removeItem('octotriage.oauth-state');
    url.searchParams.delete('code'); url.searchParams.delete('state');
    window.history.replaceState({}, '', url.toString());
    if (!expectedState || !returnedState || expectedState !== returnedState) {
      setOauthError('The sign-in check did not match. Start a fresh GitHub connection.');
      return;
    }
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    exchange.mutate({ data: { code, redirectUri } }, {
      onSuccess: (result) => { setOauthError(''); setToken(result.accessToken); exchange.reset(); },
      onError: () => setOauthError('GitHub could not finish the connection. Please try again.'),
    });
    // OAuth callback is intentionally handled once on initial page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setFetchingAccount(true); setAccountError(''); setBoardError(null);
    Promise.all([
      githubRequest<GitHubUser>(token, '/user'),
      githubPages<GitHubRepo>(token, '/user/repos?type=all&sort=updated&direction=desc'),
    ]).then(([nextUser, nextRepos]) => {
      if (cancelled) return;
      setUser(nextUser);
      setRepos(nextRepos);
      setPrefs(getSavedPrefs(nextUser.login));
      const saved = getSavedSelection(nextUser.login).filter((id) => nextRepos.some((repo) => repo.id === id));
      setSelectedRepoIds(saved.length ? saved : nextRepos.slice(0, Math.min(nextRepos.length, 4)).map((repo) => repo.id));
    }).catch((error: Error) => {
      if (cancelled) return;
      const fault = error as ApiFault;
      setAccountError(fault.status === 401 ? 'Your GitHub session has expired. Reconnect to continue.' : fault.message || 'Could not load GitHub repositories.');
      setBoardError(fault);
    }).finally(() => { if (!cancelled) setFetchingAccount(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedRepoIds.length) { setItems([]); setBoardError(null); return; }
    const chosen = repos.filter((repo) => selectedRepoIds.includes(repo.id));
    if (!chosen.length) return;
    const cacheKey = `${user?.login ?? 'unknown'}:${selectedRepoIds.slice().sort((a, b) => a - b).join(',')}:${refreshCount}`;
    const cached = boardCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < BOARD_CACHE_TTL) {
      setItems(cached.items);
      setBoardError(null);
      setFetchingItems(false);
      return;
    }
    let cancelled = false;
    setFetchingItems(true); setBoardError(null);
    mapWithConcurrency(chosen, 4, async (repo) => {
      const [rows, pulls] = await Promise.all([
        githubPages<Omit<TriageItem, 'repository'>>(token, `/repos/${repo.full_name}/issues?state=open&sort=updated&direction=desc`),
        githubPages<{ number: number; draft: boolean; merged_at: string | null; requested_reviewers: { login: string; avatar_url: string }[] }>(token, `/repos/${repo.full_name}/pulls?state=open&sort=updated&direction=desc`),
      ]);
      const pullDetails = new Map(pulls.map((pull) => [pull.number, pull]));
      return rows.map((row) => {
        const detail = pullDetails.get(row.number);
        return {
          ...row,
          pull_request: row.pull_request ? { ...row.pull_request, draft: detail?.draft, merged_at: detail?.merged_at } : undefined,
          requested_reviewers: detail?.requested_reviewers || [],
          repository: { owner: repo.owner.login, name: repo.name, full_name: repo.full_name },
        } as TriageItem;
      });
    }).then((results) => {
      if (cancelled) return;
      const deduped = new Map<number, TriageItem>();
      results.flat().forEach((item) => deduped.set(item.id, item));
      const nextItems = Array.from(deduped.values());
      if (boardCache.size >= 20) {
        const oldestKey = Array.from(boardCache.entries()).sort((a, b) => a[1].savedAt - b[1].savedAt)[0]?.[0];
        if (oldestKey) boardCache.delete(oldestKey);
      }
      boardCache.set(cacheKey, { items: nextItems, savedAt: Date.now() });
      setItems(nextItems);
    }).catch((error: Error) => {
      if (cancelled) return;
      setBoardError(error as ApiFault);
      setItems([]);
    }).finally(() => { if (!cancelled) setFetchingItems(false); });
    return () => { cancelled = true; };
  }, [token, selectedRepoIds, repos, refreshCount, user?.login]);

  useEffect(() => {
    if (!token || selectedRepoIds.length === 0) return;
    const timer = window.setInterval(() => {
      setRefreshCount((count) => count + 1);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [token, selectedRepoIds.join(',')]);

  function connect() {
    const clientId = configQuery.data?.clientId;
    if (!clientId) return;
    const nonce = crypto.randomUUID();
    sessionStorage.setItem('octotriage.oauth-state', nonce);
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state: nonce, scope: 'repo read:user' });
    window.location.assign(`https://github.com/login/oauth/authorize?${params.toString()}`);
  }

  function disconnect() {
    setToken(null); setUser(null); setRepos([]); setItems([]); setSelectedRepoIds([]);
    boardCache.clear();
    queryClient.getMutationCache().clear();
    setAccountError(''); setBoardError(null); setOauthError(''); setNotice(''); setLabelDrafts({});
    sessionStorage.removeItem('octotriage.oauth-state');
    setPrefs({ kind: 'all', sort: 'updated', contributor: 'all' }); setSearch('');
  }

  function toggleRepo(id: number) {
    setSelectedRepoIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  async function runAction(item: TriageItem, action: 'close' | 'merge' | 'request-changes') {
    if (!token) return;
    const key = `${action}:${item.id}`;
    setActionId(key); setNotice('');
    const removesItem = action === 'close' || action === 'merge';
    if (removesItem) setItems((current) => current.filter((entry) => entry.id !== item.id));
    try {
      if (action === 'close') {
        await githubRequest(token, `/repos/${item.repository.full_name}/issues/${item.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
        boardCache.clear();
        setNotice(`#${item.number} closed`);
      } else if (action === 'merge') {
        const result = await githubRequest<{ merged: boolean; message?: string }>(token, `/repos/${item.repository.full_name}/pulls/${item.number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'squash' }) });
        if (!result.merged) throw new Error(result.message || 'GitHub did not merge this pull request.');
        boardCache.clear();
        setNotice(`#${item.number} merged`);
      } else {
        const body = window.prompt('Add a note for the author before requesting changes:');
        if (!body?.trim()) return;
        await githubRequest(token, `/repos/${item.repository.full_name}/pulls/${item.number}/reviews`, { method: 'POST', body: JSON.stringify({ body, event: 'REQUEST_CHANGES' }) });
        boardCache.clear();
        setNotice(`Changes requested on #${item.number}`);
      }
    } catch (error) {
      const fault = error as ApiFault;
      if (removesItem && selectedRepos.some((repo) => repo.full_name === item.repository.full_name)) {
        setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
      }
      setBoardError(fault); setNotice(fault.message || 'That action could not be completed.');
    } finally { setActionId(null); }
  }

  async function changeLabel(item: TriageItem, label: string, mode: 'add' | 'remove') {
    if (!token || !label.trim()) return;
    const key = `label:${item.id}`;
    setActionId(key); setNotice('');
    try {
      if (mode === 'add') {
        const normalized = label.trim();
        setItems((current) => current.map((entry) => entry.id === item.id && !entry.labels.some((existing) => existing.name.toLowerCase() === normalized.toLowerCase())
          ? { ...entry, labels: [...entry.labels, { id: -Date.now(), name: normalized, color: '8a7f70' }] }
          : entry));
        const labels = await githubRequest<Label[]>(token, `/repos/${item.repository.full_name}/issues/${item.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [label.trim()] }) });
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, labels } : entry));
        boardCache.clear();
        setLabelDrafts((current) => ({ ...current, [item.id]: '' }));
        setNotice(`Label added to #${item.number}`);
      } else {
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, labels: entry.labels.filter((existing) => existing.name !== label) } : entry));
        const labels = await githubRequest<Label[]>(token, `/repos/${item.repository.full_name}/issues/${item.number}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, labels } : entry));
        boardCache.clear();
        setNotice(`Label removed from #${item.number}`);
      }
    } catch (error) {
      const fault = error as ApiFault;
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, labels: item.labels } : entry));
      setBoardError(fault); setNotice(fault.status === 404 ? 'That label does not exist in this repository.' : fault.message || 'Could not update labels.');
    } finally { setActionId(null); }
  }

  const displayedRepos = repos.filter((repo) => repo.full_name.toLowerCase().includes(repoSearch.toLowerCase()));
  const sections: SectionKey[] = ['incoming', 'review', 'stale', 'blocked'];
  const configUnavailable = !configQuery.isLoading && !configQuery.isError && !configQuery.data?.clientId;
  const rateLimited = boardError?.status === 403 && boardError.remaining === '0';

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground backdrop-blur-md">
      {!token ? (
        <ConnectScreen
          configLoading={configQuery.isLoading || exchange.isPending}
          configError={configQuery.isError ? 'OAuth configuration could not be loaded.' : ''}
          configUnavailable={configUnavailable}
          oauthError={oauthError}
          accountError={accountError}
          onConnect={connect}
          onRetry={() => { setOauthError(''); void configQuery.refetch(); }}
        />
      ) : (
        <div className="flex min-h-[100dvh]">
     <header className="sticky topbar menu-bgs">
  <div className="topbar-left">
    {/* <!-- Hamburger menu --> */}
    <details className="site-navigation">
      <summary
        className="hamburger-trigger"
        aria-label="Toggle main navigation"
      >
        <svg
          className="hamburger-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>

        <svg
          className="close-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </summary>

      <nav className="site-menu" aria-label="Main navigation">
        <p className="site-menu-label">Workspace</p>

        <a className="menu-item" href="/">
          <svg className="icon" aria-hidden="true">
            <use href="#i-globe" />
          </svg>
          <span>The work queue</span>
        </a> 
      </nav>
    </details>

    {/* <!-- Custom code-style logo --> */}
    <a className="brand" href="/" aria-label="Logic HQ home">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Code2 size={1} strokeWidth={0.1} />
              <svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 256 256">
	<path d="M0 0h256v256H0z" fill="none" />
	<g fill="currentColor">
		<path d="M232 116a60 60 0 0 1-60 60h-12v40H96v-80H84a60 60 0 0 1-60-60a20 20 0 0 1 20-20a20 20 0 0 1 20 20a20 20 0 0 0 20 20h12V56a32 32 0 0 1 32-32a32 32 0 0 1 32 32v80h12a20 20 0 0 0 20-20a20 20 0 0 1 20-20a20 20 0 0 1 20 20" opacity=".2" />
		<path d="M216 208h-48v-24h4a68.07 68.07 0 0 0 68-68a28 28 0 0 0-56 0a12 12 0 0 1-12 12h-4V56a40 40 0 0 0-80 0v32h-4a12 12 0 0 1-12-12a28 28 0 0 0-56 0a68.07 68.07 0 0 0 68 68h4v64H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16M96 128H84a52.06 52.06 0 0 1-52-52a12 12 0 0 1 24 0a28 28 0 0 0 28 28h12a8 8 0 0 0 8-8V56a24 24 0 0 1 48 0v80a8 8 0 0 0 8 8h12a28 28 0 0 0 28-28a12 12 0 0 1 24 0a52.06 52.06 0 0 1-52 52h-12a8 8 0 0 0-8 8v32h-48v-72a8 8 0 0 0-8-8" />
	</g>
</svg>
              </div>

      {/* <span className="brand-name">Logic HQ</span> */}
      <div className="flex items-center gap-3 px-2">
                <div>
                  <div className="display text-[16px] font-extrabold leading-none">OctoTriage</div>
                  <div className="mono mt-1 text-[9px] tracking-[.16em] text-muted-foreground">MAINTAINER DESK</div>
                </div>
              </div>
    </a>
  </div>

    {/* <a className="brand" href="#">My dashboard</a> */}

{/* <div className="min-w-0">
                    <div className="mono text-[9px] font-medium tracking-[.17em] text-muted-foreground">GITHUB / TRIAGE</div>
                    <h1 className="display mt-0.5 truncate text-[21px] font-extrabold sm:text-[24px]">The work queue<span className="text-primary">.</span></h1>
                  </div> */}


     <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-2 mt-3 px-4 pb-3.5 sm:px-7 lg:px-10">
                <div className="relative min-w-[210px] flex-1 sm:max-w-[340px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input aria-label="Search issues and pull requests" data-testid="input-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, repo, label…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-xs outline-none transition placeholder:text-muted-foreground/80 focus:border-primary/55 focus:ring-2 focus:ring-primary/10" />
                  {search && <button type="button" onClick={() => setSearch('')} data-testid="button-clear-search" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setFilterOpen((value) => !value)} data-testid="button-filters" className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${prefs.kind !== 'all' || prefs.sort !== 'updated' || prefs.contributor !== 'all' ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card hover:bg-secondary'}`}><SlidersHorizontal size={14} /> Filters <ChevronDown size={13} /></button>
                  {filterOpen && <div className="absolute right-0 top-11 z-30 w-60 rounded-xl border border-border bg-popover p-3 shadow-lg">
                    <div className="mono mb-2 text-[9px] tracking-[.15em] text-muted-foreground">SHOW</div>
                    <div className="grid grid-cols-3 gap-1">{(['all', 'issues', 'prs'] as const).map((value) => <button type="button" key={value} data-testid={`filter-kind-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, kind: value }))} className={`rounded-md px-2 py-1.5 text-[11px] capitalize ${prefs.kind === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-muted'}`}>{value === 'prs' ? 'PRs' : value}</button>)}</div>
                    <div className="mono mb-2 mt-4 text-[9px] tracking-[.15em] text-muted-foreground">SORT BY</div>
                    {(['updated', 'created', 'comments'] as const).map((value) => <button type="button" key={value} data-testid={`sort-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, sort: value }))} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs capitalize hover:bg-secondary"><span>{value === 'updated' ? 'Recently active' : value === 'created' ? 'Newest created' : 'Most discussion'}</span>{prefs.sort === value && <Check size={14} className="text-primary" />}</button>)}
                    <div className="mono mb-2 mt-4 text-[9px] tracking-[.15em] text-muted-foreground">CONTRIBUTOR</div>
                    <div className="grid grid-cols-2 gap-1">{(['all', 'first-time'] as const).map((value) => <button type="button" key={value} data-testid={`filter-contributor-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, contributor: value }))} className={`rounded-md px-2 py-1.5 text-[11px] ${prefs.contributor === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-muted'}`}>{value === 'all' ? 'Everyone' : 'First-time'}</button>)}</div>
                  </div>}
                </div>
                <button type="button" onClick={() => setRepoPickerOpen((value) => !value)} data-testid="button-mobile-repositories" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary md:hidden"><Layers3 size={14} /> Repos <span className="mono text-muted-foreground">{selectedRepos.length}</span></button>
                {repoPickerOpen && <div className="absolute left-4 right-4 top-[132px] z-30 rounded-xl border border-border bg-popover p-3 shadow-lg md:hidden"><RepoPicker repos={displayedRepos} selected={selectedRepoIds} search={repoSearch} setSearch={setRepoSearch} toggle={toggleRepo} close={() => setRepoPickerOpen(false)} /></div>}
                
                {/* <div className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"><Activity size={13} /> {items.length} open items</div> */}

              </div>

          {/* Refresh         */}
<button type="button" onClick={() => setRefreshCount((count) => count + 1)} data-testid="button-refresh" aria-label="Refresh queue" title="Refresh queue" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60" disabled={fetchingItems}><RefreshCw size={14} className={fetchingItems ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button>

    {/* <!-- Remove "open" to start with the menu collapsed. --> */}
    {/* <!-- <details className="profile-dropdown" open> --> */}

    {/* <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#507d68]" /> Connected as <strong className="font-semibold text-foreground">@{user?.login}</strong></div> */}
    <div className="hidden items-center gap-2 rounded-full px-3 py-2 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full" /><strong className="font-semibold text-foreground">@{user?.login}</strong></div>

    <details className="profile-dropdown">
      <summary className="profile-trigger" aria-label="Toggle profile navigation">
        {/* <!-- Replace this image with your own avatar. --> */}

        {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full border border-border object-cover" /> : <div className="h-8 w-8 rounded-full bg-secondary" />}
        {/* <img className="avatar" src="https://github.com/identicons/Logic-HQ.png"  alt="Your profile" /> */}
        <span className="notification-dot" aria-hidden="true"></span>
      </summary>

      <nav className="profile-menu top-menu-ow" aria-label="Profile">
          <div className="account-row">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full border border-border object-cover" /> : <div className="h-8 w-8 rounded-full bg-secondary" />}
            {/* <img className="avatar account-avatar" src="https://github.com/identicons/Logic-HQ.png" alt="" /> */}
            {/* AVATARN2 */}
            <div className="account-info">
            <div className="account-name min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user?.name || user?.login || 'GitHub user'}</div><div className="mono truncate account-handle text-[10px] text-muted-foreground">@{user?.login}</div></div>
          </div>

          <button className="icon-button" type="button" aria-label="Switch account">
            <svg className="icon" aria-hidden="true"><use href="#i-switch" /></svg>
          </button>
        </div>
  
        {/* <hr className="menu-divider" /> */}

        {/* <a className="menu-item" href="/settings/appearance">
          <svg className="icon" aria-hidden="true"><use href="#i-brush" /></svg>
          <span>Appearance</span>
          <span className="badge badge-new">Light</span>
          <span className="badge badge-new">Dark</span>
        </a> */}

        <hr className="menu-divider" />

       <button className="menu-item" type="button">
          <svg className="icon" aria-hidden="true"><use href="#i-smile" /></svg>
          {/* <span>Set status</span> */}
          <div className="flex items-center gap-1.5  pt-2.5 text-[10px] text-muted-foreground"><ShieldCheck size={12} className="text-[#507d68]" /> Token clears when you disconnect or reload</div>
        </button>
        
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground menu-item" onClick={disconnect} type="button" aria-label="Clear local GitHub session" data-testid="button-disconnect" title="Clear local GitHub session" >
                     
          <span>Sign out</span>
            {/* <LogOut size={15} /> */} 
            
               <span className="badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
                  <path d="M0 0h24v24H0z" fill="none" />
                  <path fill="currentColor" d="M5 5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h7v-2H5zm16 7l-4-4v3H9v2h8v3z" />
                </svg>
                </span>
            </button>
   
      </nav>
    </details>
  </header>


          
          <aside className="hidden w-[252px] mt72 shrink-0 flex-col border-r border-sidebar-border menu-bgs px-4 py-5 md:flex">
              
            <div className="mt-9 flex items-center justify-between px-2">
              <div className="mono text-[10px] font-medium tracking-[.16em] text-muted-foreground">WORKSPACE</div>
              <span className="mono text-[10px] text-muted-foreground">{selectedRepos.length}/{repos.length}</span>
            </div>
            <button type="button" onClick={() => setRepoPickerOpen((value) => !value)} data-testid="button-repository-picker" className={`mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition ${repoPickerOpen ? 'border-primary/40 bg-card' : 'border-sidebar-border bg-card/55 hover:bg-card'}`}>
              <span className="flex min-w-0 items-center gap-2.5"><Layers3 size={15} className="shrink-0 text-primary" /><span className="truncate text-[13px] font-semibold">{selectedRepos.length === 1 ? selectedRepos[0].name : `${selectedRepos.length} repositories`}</span></span><ChevronDown size={15} className={`text-muted-foreground transition-transform ${repoPickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {repoPickerOpen && <RepoPicker repos={displayedRepos} selected={selectedRepoIds} search={repoSearch} setSearch={setRepoSearch} toggle={toggleRepo} close={() => setRepoPickerOpen(false)} />}
            <div className="mt-8 px-2">
              <div className="mono text-[10px] font-medium tracking-[.16em] text-muted-foreground">TRIAGE QUEUE</div>
              <div className="mt-3 space-y-1">
                {sections.map((key) => {
                  const info = groupInfo[key]; const Icon = info.icon;
                  const count = visibleItems.filter((item) => classify(item, user?.login ?? '') === key).length;
                  return <div key={key} className="flex items-center justify-between rounded-lg px-2.5 py-2.5 text-[13px] text-foreground/80"><span className="flex items-center gap-2.5"><Icon size={15} className={info.color} />{info.title}</span><span className="mono text-[11px] text-muted-foreground">{count.toString().padStart(2, '0')}</span></div>;
                })}
              </div>
            </div>
            {/* AVATARN */}
            {/* <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar/60 p-3">
              <div className="flex items-center gap-2.5">
                {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full border border-border object-cover" /> : <div className="h-8 w-8 rounded-full bg-secondary" />}
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user?.name || user?.login || 'GitHub user'}</div><div className="mono truncate text-[10px] text-muted-foreground">@{user?.login}</div></div>
                <button onClick={disconnect} type="button" aria-label="Clear local GitHub session" data-testid="button-disconnect" title="Clear local GitHub session" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><LogOut size={15} /></button>
              </div>
              <div className="mt-3 flex items-center gap-1.5 border-t border-sidebar-border pt-2.5 text-[10px] text-muted-foreground"><ShieldCheck size={12} className="text-[#507d68]" /> Token clears when you disconnect or reload</div>
            </div> */}
          </aside>

          <main className="min-w-0 mt72 flex-1">

            
            {/* <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95"> */}
            <header className="sticky top-0 z-20 bg-background/95">
              <div className="mx-auto flex max-w-[1560px] items-center justify-between gap-3 px-4 py-3.5 sm:px-7 lg:px-10">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground md:hidden"><Code2 size={18} /></div>
                                    <div className="min-w-0">
                    <div className="mono text-[9px] font-medium tracking-[.17em] text-muted-foreground">GITHUB / TRIAGE</div>
                    <h1 className="display mt-0.5 truncate text-[21px] font-extrabold sm:text-[24px]">The work queue<span className="text-primary">.</span></h1>
                  </div>




 <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
                <div><p className="mono text-[10px] tracking-[.16em] text-muted-foreground">YOUR MAINTAINER SNAPSHOT</p><p className="display mt-1.5 text-[15px] font-semibold text-foreground/80">{selectedRepos.length ? <>{visibleItems.length} open {visibleItems.length === 1 ? 'item' : 'items'} across <span className="text-primary">{selectedRepos.length} {selectedRepos.length === 1 ? 'repo' : 'repos'}</span></> : 'Choose repositories to load your queue'}</p></div>
                <div className="mono text-[10px] text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</div>
              </div>

                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#507d68]" /> Connected as <strong className="font-semibold text-foreground">@{user?.login}</strong></div> */}
                  {/* <button type="button" onClick={() => setRefreshCount((count) => count + 1)} data-testid="button-refresh" aria-label="Refresh queue" title="Refresh queue" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60" disabled={fetchingItems}><RefreshCw size={14} className={fetchingItems ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button> */}
                  <button type="button" onClick={disconnect} data-testid="button-disconnect-mobile" aria-label="Clear local GitHub session" title="Clear local GitHub session" className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-primary md:hidden"><LogOut size={15} /></button>
                </div>
                {/* AVATOP */}
            
              </div>
              {/* <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-2 px-4 pb-3.5 sm:px-7 lg:px-10">
                <div className="relative min-w-[210px] flex-1 sm:max-w-[340px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input aria-label="Search issues and pull requests" data-testid="input-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, repo, label…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-xs outline-none transition placeholder:text-muted-foreground/80 focus:border-primary/55 focus:ring-2 focus:ring-primary/10" />
                  {search && <button type="button" onClick={() => setSearch('')} data-testid="button-clear-search" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setFilterOpen((value) => !value)} data-testid="button-filters" className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${prefs.kind !== 'all' || prefs.sort !== 'updated' || prefs.contributor !== 'all' ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card hover:bg-secondary'}`}><SlidersHorizontal size={14} /> Filters <ChevronDown size={13} /></button>
                  {filterOpen && <div className="absolute right-0 top-11 z-30 w-60 rounded-xl border border-border bg-popover p-3 shadow-lg">
                    <div className="mono mb-2 text-[9px] tracking-[.15em] text-muted-foreground">SHOW</div>
                    <div className="grid grid-cols-3 gap-1">{(['all', 'issues', 'prs'] as const).map((value) => <button type="button" key={value} data-testid={`filter-kind-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, kind: value }))} className={`rounded-md px-2 py-1.5 text-[11px] capitalize ${prefs.kind === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-muted'}`}>{value === 'prs' ? 'PRs' : value}</button>)}</div>
                    <div className="mono mb-2 mt-4 text-[9px] tracking-[.15em] text-muted-foreground">SORT BY</div>
                    {(['updated', 'created', 'comments'] as const).map((value) => <button type="button" key={value} data-testid={`sort-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, sort: value }))} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs capitalize hover:bg-secondary"><span>{value === 'updated' ? 'Recently active' : value === 'created' ? 'Newest created' : 'Most discussion'}</span>{prefs.sort === value && <Check size={14} className="text-primary" />}</button>)}
                    <div className="mono mb-2 mt-4 text-[9px] tracking-[.15em] text-muted-foreground">CONTRIBUTOR</div>
                    <div className="grid grid-cols-2 gap-1">{(['all', 'first-time'] as const).map((value) => <button type="button" key={value} data-testid={`filter-contributor-${value}`} onClick={() => setPrefs((prev) => ({ ...prev, contributor: value }))} className={`rounded-md px-2 py-1.5 text-[11px] ${prefs.contributor === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-muted'}`}>{value === 'all' ? 'Everyone' : 'First-time'}</button>)}</div>
                  </div>}
                </div>
                <button type="button" onClick={() => setRepoPickerOpen((value) => !value)} data-testid="button-mobile-repositories" className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary md:hidden"><Layers3 size={14} /> Repos <span className="mono text-muted-foreground">{selectedRepos.length}</span></button>
                {repoPickerOpen && <div className="absolute left-4 right-4 top-[132px] z-30 rounded-xl border border-border bg-popover p-3 shadow-lg md:hidden"><RepoPicker repos={displayedRepos} selected={selectedRepoIds} search={repoSearch} setSearch={setRepoSearch} toggle={toggleRepo} close={() => setRepoPickerOpen(false)} /></div>}
                <div className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"><Activity size={13} /> {items.length} open items</div>
              </div> */}
            </header>

            <div className="mx-auto max-w-[1560px] px-4 pb-12 pt-7 sm:px-7 lg:px-10">
             
              {boardError && <div role="alert" data-testid="status-board-error" className="mb-5 flex items-start gap-3 rounded-xl border border-[#c57b54]/30 bg-[#c57b54]/[.08] p-3.5 text-xs"><AlertCircle size={16} className="mt-0.5 shrink-0 text-[#a96335]" /><div className="flex-1"><div className="font-semibold">{rateLimited ? 'GitHub rate limit reached' : 'Could not refresh the queue'}</div><p className="mt-1 leading-relaxed text-muted-foreground">{rateLimited ? `GitHub asks us to pause${boardError.resetAt ? ` until ${boardError.resetAt}` : ''}. Your existing session and selection are safe.` : boardError.message}</p></div><button onClick={() => { setBoardError(null); setRefreshCount((count) => count + 1); }} type="button" data-testid="button-retry" className="rounded-md border border-border bg-card px-2.5 py-1.5 font-semibold hover:bg-secondary">Retry</button></div>}
              {accountError && <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive"><AlertCircle size={15} />{accountError}<button onClick={disconnect} className="ml-auto underline" type="button">Reconnect</button></div>}
              {notice && <div role="status" data-testid="status-action-notice" className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><CheckCheck size={14} className="text-[#507d68]" />{notice}</div>}

              {fetchingAccount || (fetchingItems && items.length === 0) ? <BoardSkeleton /> : selectedRepoIds.length === 0 ? <EmptyBoard title="Pick your repositories" text="Choose one or more repositories from the workspace menu to build your triage queue." action={<button type="button" onClick={() => setRepoPickerOpen(true)} data-testid="button-select-repositories" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground hover:brightness-95"><Plus size={14} /> Select repositories</button>} /> : !fetchingItems && visibleItems.length === 0 ? <EmptyBoard title={search ? 'Nothing matched that search' : 'Queue is clear'} text={search ? 'Try a shorter query or clear the search to see the full queue.' : 'No open issues or pull requests in the selected repositories. Go get some water.'} action={search ? <button type="button" onClick={() => setSearch('')} data-testid="button-empty-clear-search" className="mt-4 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold hover:bg-secondary">Clear search</button> : undefined} /> : (
                <div className="board-scroll -mx-4 flex items-start gap-4 overflow-x-auto px-4 pb-5 sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">
                  {sections.map((section, index) => {
                    const meta = groupInfo[section]; const Icon = meta.icon;
                    const grouped = visibleItems.filter((item) => classify(item, user?.login ?? '') === section);
                    return <section key={section} className="enter w-[min(86vw,360px)] shrink-0 sm:w-[335px]" style={{ animationDelay: `${index * 60}ms` }} data-testid={`column-${section}`}>
                      <div className="mb-3 flex items-center justify-between border-b border-border/80 pb-3">
                        <div className="flex items-center gap-2.5"><div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-card shadow-sm ${meta.color}`}><Icon size={15} /></div><div><h2 className="display text-[13px] font-bold">{meta.title}</h2><p className="mono mt-0.5 text-[8px] tracking-[.13em] text-muted-foreground">{meta.eyebrow}</p></div></div>
                        <span className="mono rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{String(grouped.length).padStart(2, '0')}</span>
                      </div>
                      <p className="mb-3 px-0.5 text-[10px] text-muted-foreground">{meta.detail}</p>
                      <div className="space-y-2.5">
                        {grouped.length ? grouped.map((item) => <TriageCard key={`${item.repository.full_name}-${item.id}`} item={item} actionId={actionId} labelDraft={labelDrafts[item.id] || ''} setLabelDraft={(value) => setLabelDrafts((current) => ({ ...current, [item.id]: value }))} onAction={runAction} onLabel={changeLabel} />) : <div className="rounded-xl border border-dashed border-border/90 px-4 py-6 text-center"><div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Check size={15} /></div><p className="mt-2 text-[11px] font-medium text-muted-foreground">Nothing waiting here</p></div>}
                      </div>
                    </section>;
                  })}
                </div>
              )}
              <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><ShieldCheck size={12} /> GitHub API · direct from your browser · no repository data stored</span><span className="mono">OCTOTRIAGE / 01</span></footer>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function RepoPicker({ repos, selected, search, setSearch, toggle, close }: { repos: GitHubRepo[]; selected: number[]; search: string; setSearch: (value: string) => void; toggle: (id: number) => void; close: () => void }) {
  return <div className="w-full md:w-[260px]">
    <div className="mb-2 flex items-center justify-between"><span className="mono text-[9px] tracking-[.16em] text-muted-foreground">SELECT REPOSITORIES</span><button type="button" onClick={close} data-testid="button-close-repo-picker" className="rounded p-1 text-muted-foreground hover:bg-secondary"><X size={13} /></button></div>
    <div className="relative mb-2"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Find repository" data-testid="input-repository-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a repository" className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[11px] outline-none focus:border-primary/50" /></div>
    <div className="max-h-64 space-y-0.5 overflow-y-auto">
      {repos.map((repo) => <button type="button" key={repo.id} onClick={() => toggle(repo.id)} data-testid={`repo-option-${repo.id}`} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-secondary">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected.includes(repo.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card'}`}>{selected.includes(repo.id) && <Check size={11} />}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">{repo.name}</span><span className="mono block truncate text-[9px] text-muted-foreground">{repo.owner.login}/{repo.name}</span></span>
        {repo.private && <span className="mono rounded bg-secondary px-1 py-0.5 text-[8px] text-muted-foreground">PRIVATE</span>}
      </button>)}
      {repos.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No repositories found.</p>}
    </div>
    <div className="mt-2 flex items-center justify-between border-t border-border pt-2"><span className="mono text-[9px] text-muted-foreground">{selected.length} SELECTED</span><button type="button" onClick={close} data-testid="button-done-repos" className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">Done</button></div>
  </div>;
}

function TriageCard({ item, actionId, labelDraft, setLabelDraft, onAction, onLabel }: {
  item: TriageItem; actionId: string | null; labelDraft: string; setLabelDraft: (value: string) => void;
  onAction: (item: TriageItem, action: 'close' | 'merge' | 'request-changes') => void;
  onLabel: (item: TriageItem, label: string, mode: 'add' | 'remove') => void;
}) {
  const isPr = isPullRequest(item);
  const busy = actionId?.endsWith(`:${item.id}`) || actionId === `label:${item.id}`;
  return <article data-testid={`card-triage-${item.id}`} className="group rounded-xl border border-card-border bg-card p-3.5 shadow-[0_3px_14px_rgba(49,37,26,.035)] transition hover:-translate-y-0.5 hover:shadow-[0_7px_20px_rgba(49,37,26,.085)]">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span className="max-w-[150px] truncate font-semibold text-foreground/75">{item.repository.full_name}</span><span className="text-border">/</span><span className="mono shrink-0">#{item.number}</span></div>
      <div className="flex shrink-0 items-center gap-1.5">{isFirstTimeContributor(item) && <span data-testid={`badge-first-contributor-${item.id}`} className="rounded bg-primary/10 px-1 py-0.5 text-[8px] font-semibold text-primary">FIRST-TIME</span>}{isPr ? <GitPullRequest size={13} className="text-[#507d68]" /> : <CircleDot size={13} className="text-[#a96335]" />}<span className="mono text-[9px] uppercase tracking-wide text-muted-foreground">{isPr ? 'PR' : 'ISSUE'}</span></div>
    </div>
    <a href={item.html_url} target="_blank" rel="noreferrer" data-testid={`link-item-${item.id}`} className="mt-2 block text-[13px] font-semibold leading-[1.45] text-foreground decoration-primary/60 underline-offset-2 hover:text-primary hover:underline">{item.title}</a>
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {item.user?.avatar_url ? <img src={item.user.avatar_url} alt="" className="h-5 w-5 rounded-full border border-border object-cover" /> : <div className="h-5 w-5 rounded-full bg-secondary" />}
        <span className="max-w-[110px] truncate text-[10px] text-muted-foreground">{item.user?.login || 'unknown'}</span>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground"><Clock3 size={11} />{relativeDate(item.updated_at)}</span>
    </div>
    {item.labels.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{item.labels.map((label) => <span key={label.id} className="group/label inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium" style={labelColor(label.color)}><span className="max-w-[130px] truncate">{label.name}</span><button type="button" aria-label={`Remove label ${label.name}`} data-testid={`button-remove-label-${item.id}-${label.id}`} onClick={() => onLabel(item, label.name, 'remove')} disabled={Boolean(busy)} className="opacity-60 hover:opacity-100"><X size={10} /></button></span>)}</div>}
    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><MessageSquare size={12} /><span>{item.comments} {item.comments === 1 ? 'comment' : 'comments'}</span>{item.requested_reviewers?.length ? <span className="ml-auto truncate">Review requested · {item.requested_reviewers.map((person) => person.login).join(', ')}</span> : item.assignees?.length > 0 && <span className="ml-auto truncate">Assigned · {item.assignees.map((person) => person.login).join(', ')}</span>}</div>
    <div className="mt-3 flex gap-1.5 border-t border-border/70 pt-2.5">
      <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); onLabel(item, labelDraft, 'add'); }}>
        <Tag size={12} className="shrink-0 text-muted-foreground" />
        <input aria-label={`Add a label to ${item.title}`} data-testid={`input-label-${item.id}`} value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} placeholder="Add label…" className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-muted-foreground/70" />
        <button type="submit" aria-label="Add label" data-testid={`button-add-label-${item.id}`} disabled={!labelDraft.trim() || Boolean(busy)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:opacity-35"><Plus size={13} /></button>
      </form>
      {isPr && <button type="button" onClick={() => onAction(item, 'request-changes')} disabled={Boolean(busy)} data-testid={`button-request-changes-${item.id}`} title="Request changes" className="rounded-md border border-border px-2 text-[9px] font-semibold text-foreground/75 hover:border-[#a77a28]/40 hover:bg-[#a77a28]/[.08] disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : 'Review'}</button>}
      {isPr && <button type="button" onClick={() => onAction(item, 'merge')} disabled={Boolean(busy)} data-testid={`button-merge-${item.id}`} title="Merge pull request" className="rounded-md bg-[#507d68] px-2 text-[9px] font-semibold text-white hover:brightness-95 disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : 'Merge'}</button>}
      <button type="button" onClick={() => onAction(item, 'close')} disabled={Boolean(busy)} data-testid={`button-close-item-${item.id}`} title="Close issue or pull request" className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <XCircle size={13} />}</button>
    </div>
  </article>;
}

function BoardSkeleton() {
  return <div className="board-scroll -mx-4 flex gap-4 overflow-hidden px-4 sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">{[0, 1, 2, 3].map((column) => <div key={column} className="w-[min(86vw,360px)] shrink-0 sm:w-[335px]"><div className="mb-4 flex items-center gap-3 border-b border-border pb-3"><div className="skeleton h-8 w-8 rounded-lg" /><div className="space-y-2"><div className="skeleton h-3 w-24 rounded" /><div className="skeleton h-2 w-16 rounded" /></div></div>{[0, 1, 2].map((card) => <div key={card} className="mb-3 rounded-xl border border-card-border bg-card p-4"><div className="skeleton h-2.5 w-32 rounded" /><div className="skeleton mt-4 h-4 w-full rounded" /><div className="skeleton mt-2 h-4 w-3/4 rounded" /><div className="mt-5 flex justify-between"><div className="skeleton h-5 w-20 rounded-full" /><div className="skeleton h-3 w-14 rounded" /></div></div>)}</div>)}</div>;
}

function EmptyBoard({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="enter flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-5 text-center">
    <div className="relative mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-[22px] border border-border bg-card shadow-sm"><div className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border-[3px] border-background bg-primary" /><Layers3 size={25} strokeWidth={1.5} className="text-primary" /></div>
    <h2 className="display text-xl font-bold">{title}</h2><p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">{text}</p>{action}
  </div>;
}

function ConnectScreen({ configLoading, configError, configUnavailable, oauthError, accountError, onConnect, onRetry }: {
  configLoading: boolean; configError: string; configUnavailable: boolean; oauthError: string; accountError: string; onConnect: () => void; onRetry: () => void;
}) {
  return <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
    <div className="pointer-events-none absolute -left-28 top-[10%] h-[420px] w-[420px] rounded-full border border-[#d9d0c1]/70" /><div className="pointer-events-none absolute -left-16 top-[16%] h-[300px] w-[300px] rounded-full border border-[#d9d0c1]/60" />
    <div className="pointer-events-none absolute -right-32 bottom-[-180px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(190,74,51,.12),transparent_68%)]" />
    <div className="relative z-10 grid w-full max-w-[1040px] overflow-hidden rounded-[26px] border border-border bg-card shadow-[0_24px_90px_rgba(60,42,28,.12)] md:grid-cols-[1.05fr_.95fr]">
      <div className="relative flex min-h-[510px] flex-col justify-between overflow-hidden bg-[#ede7db] p-7 sm:p-10 md:p-12">
        <div className="absolute -right-14 top-20 h-64 w-64 rounded-full border-[1px] border-[#c8bca9]/70" /><div className="absolute -right-2 top-32 h-44 w-44 rounded-full border border-[#c8bca9]/70" /><div className="absolute right-10 top-44 h-24 w-24 rounded-full bg-primary/10" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Code2 size={1} strokeWidth={1} /><svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 256 256">
	<path d="M0 0h256v256H0z" fill="none" />
	<g fill="currentColor">
		<path d="M232 116a60 60 0 0 1-60 60h-12v40H96v-80H84a60 60 0 0 1-60-60a20 20 0 0 1 20-20a20 20 0 0 1 20 20a20 20 0 0 0 20 20h12V56a32 32 0 0 1 32-32a32 32 0 0 1 32 32v80h12a20 20 0 0 0 20-20a20 20 0 0 1 20-20a20 20 0 0 1 20 20" opacity=".2" />
		<path d="M216 208h-48v-24h4a68.07 68.07 0 0 0 68-68a28 28 0 0 0-56 0a12 12 0 0 1-12 12h-4V56a40 40 0 0 0-80 0v32h-4a12 12 0 0 1-12-12a28 28 0 0 0-56 0a68.07 68.07 0 0 0 68 68h4v64H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16M96 128H84a52.06 52.06 0 0 1-52-52a12 12 0 0 1 24 0a28 28 0 0 0 28 28h12a8 8 0 0 0 8-8V56a24 24 0 0 1 48 0v80a8 8 0 0 0 8 8h12a28 28 0 0 0 28-28a12 12 0 0 1 24 0a52.06 52.06 0 0 1-52 52h-12a8 8 0 0 0-8 8v32h-48v-72a8 8 0 0 0-8-8" />
	</g>
</svg>
</div><div><div className="display text-[18px] font-extrabold">OctoTriage</div><div className="mono mt-0.5 text-[9px] tracking-[.16em] text-muted-foreground">MAINTAINER DESK</div></div></div>
        <div className="relative my-12">
          <div className="mono mb-4 flex items-center gap-2 text-[10px] tracking-[.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> THE ISSUE ISN'T THE ISSUES</div>
          <h1 className="display max-w-[500px] text-[43px] font-extrabold leading-[1.02] tracking-[-.06em] sm:text-[56px]">Clear the queue.<br /><span className="text-primary">Keep shipping.</span></h1>
          <p className="mt-5 max-w-[370px] text-[14px] leading-[1.75] text-foreground/70">One steady view of every issue and pull request asking for your attention. Less tab-hopping. Better follow-through.</p>
          <div className="mt-8 flex flex-wrap gap-2">{['Unassigned', 'Needs review', 'Stale', 'Blocked'].map((item) => <span key={item} className="rounded-full border border-[#cfc4b2] bg-[#f5f0e7]/70 px-3 py-1.5 text-[10px] font-medium text-foreground/75">{item}</span>)}</div>
        </div>
        <div className="relative flex items-center justify-between border-t border-[#d3c9b9] pt-4"><span className="mono text-[9px] tracking-[.12em] text-muted-foreground">BUILT FOR THE EVERYDAY MAINTAINER</span><span className="mono text-[9px] text-muted-foreground">01 / 04</span></div>
      </div>
      <div className="flex flex-col justify-center p-7 sm:p-10 md:p-12">
        <div className="mono text-[10px] tracking-[.16em] text-muted-foreground">START WITH YOUR REPOS</div>
        <h2 className="display mt-3 text-[27px] font-extrabold leading-tight">Your queue, in focus.</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">Connect your GitHub account to pull open work straight from the source. Choose the repositories you maintain and start triaging.</p>
        <div className="mt-4 rounded-lg border border-border bg-background/70 p-3 text-[10px] leading-relaxed text-muted-foreground">
          <p><strong className="font-semibold text-foreground/80">GitHub access.</strong> This app requests <code className="mono text-[9px]">repo</code> and <code className="mono text-[9px]">read:user</code>. Repository access applies to all repositories you can access, including private ones; choosing repos here only limits what appears on the board.</p>
          <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-primary underline underline-offset-2">Manage or revoke this app in GitHub settings</a>
        </div>
        {oauthError && <div role="alert" data-testid="status-oauth-error" className="mt-5 flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-[11px] leading-relaxed text-destructive"><AlertCircle size={15} className="mt-0.5 shrink-0" />{oauthError}</div>}
        {configError && <div role="alert" data-testid="status-config-error" className="mt-5 flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-[11px] text-destructive"><AlertCircle size={15} />{configError}</div>}
        {accountError && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-[11px] text-destructive"><AlertCircle size={15} />{accountError}</div>}
        {configUnavailable && <div role="status" data-testid="status-config-missing" className="mt-5 rounded-lg border border-[#b48a49]/30 bg-[#b48a49]/[.08] p-3 text-[11px] leading-relaxed text-foreground/75">GitHub sign-in is not configured yet. Add a GitHub OAuth client ID to enable a secure connection.</div>}
        <button type="button" onClick={configError ? onRetry : onConnect} disabled={configLoading || configUnavailable} data-testid="button-connect-github" className="mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#292621] text-[13px] font-semibold text-[#f6f1e8] shadow-sm transition hover:bg-[#403a32] disabled:cursor-not-allowed disabled:opacity-50">
          {configLoading ? <LoaderCircle size={17} className="animate-spin" /> : configError ? <RefreshCw size={16} /> : <Github size={18} />}
          {configLoading ? 'Connecting securely…' : configError ? 'Retry configuration' : configUnavailable ? 'Connection unavailable' : 'Continue with GitHub'}
        </button>
        <div className="mt-6 space-y-3 border-t border-border pt-5">
          <div className="flex gap-2.5"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#507d68]" /><p className="text-[11px] leading-relaxed text-muted-foreground"><strong className="font-semibold text-foreground/80">Your token stays in this tab.</strong> It is held in memory only and cleared when you disconnect or reload.</p></div>
          <div className="flex gap-2.5"><CheckCheck size={15} className="mt-0.5 shrink-0 text-primary" /><p className="text-[11px] leading-relaxed text-muted-foreground">Repository data is read directly from GitHub. Nothing is sent to or stored by OctoTriage.</p></div>
        </div>
        <p className="mono mt-7 text-center text-[9px] tracking-[.11em] text-muted-foreground">PREFERENCES LIVE LOCALLY · DATA STAYS YOURS</p>
      </div>
    </div>
  </div>;
}

function Router() {
  return <Switch><Route path="/" component={AppHome} /><Route component={NotFound} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
