// DRAFT!

import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import OAuthCallback from './features/auth/components/OAuthCallback';
import { fetchBulkRepositoryData, RepositoryItem } from './features/triage-board/hooks/useFetchTriageData';

export default function App() {
  // 1. Core State Hooks & Store Connections
  const { token, trackedRepos, setToken, addRepo, removeRepo, logout } = useAppStore();
  const [newRepo, setNewRepo] = useState('');
  const [items, setItems] = useState<RepositoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Intercept and route the app context cleanly if dealing with an active OAuth handshake callback URL
  if (window.location.pathname === '/callback') {
    return <OAuthCallback />;
  }

  // 2. Continuous Background Polling Data Hook
  useEffect(() => {
    if (!token || trackedRepos.length === 0) {
      setItems([]);
      return;
    }

    async function loadRealtimeDashboardMetrics() {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await fetchBulkRepositoryData(trackedRepos);
        setItems(payload);
      } catch (err: any) {
        setError(err.message || 'An error occurred fetching GitHub dashboard metrics.');
      } finally {
        setIsLoading(false);
      }
    }

    loadRealtimeDashboardMetrics();
    
    // Set up an automated polling frequency loop to refresh metrics every 60 seconds
    const pollTimer = setInterval(loadRealtimeDashboardMetrics, 60000);
    return () => clearInterval(pollTimer);
  }, [token, trackedRepos]);

  // 3. Client Side Triage Triage Classification Architecture Engine
  const getCategorizedColumns = () => {
    const columns: Record<string, RepositoryItem[]> = {
      'Incoming / Unassigned': [],
      'Needs Review': [],
      'Stale Alert': [],
      'Action Blocked': []
    };

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    items.forEach((item) => {
      const itemUpdateDate = new Date(item.updatedAt);
      const lowercaseLabels = item.labels.map(l => l.name.toLowerCase());

      // Rule A: Action Blocked
      if (
        lowercaseLabels.includes('blocked') || 
        lowercaseLabels.includes('status: blocked') || 
        lowercaseLabels.includes('waiting-on-author')
      ) {
        columns['Action Blocked'].push(item);
      } 
      // Rule B: Needs Active Review (PR explicit triggers)
      else if (item.type === 'PR' && item.reviewRequestsCount > 0) {
        columns['Needs Review'].push(item);
      } 
      // Rule C: Stale alert lifecycle tracking
      else if (itemUpdateDate < sevenDaysAgo) {
        columns['Stale Alert'].push(item);
      } 
      // Rule D: Fallback baseline default landing bucket
      else if (item.assigneesCount === 0) {
        columns['Incoming / Unassigned'].push(item);
      } 
      // General safety fallback if none strictly hit
      else {
        columns['Incoming / Unassigned'].push(item);
      }
    });

    return columns;
  };

  // 4. Interactivity Action Form Helpers
  const handleLoginRedirect = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID';
    window.location.href = `https://github.com{clientId}&scope=repo`;
  };

  const handleAddRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepo.includes('/')) return alert('Please input repository mapping using standard format: owner/name');
    const [owner, name] = newRepo.split('/');
    
    // Guard tracking check logic block to prevent tracking duplicates inside local arrays
    if (trackedRepos.some(r => r.owner.toLowerCase() === owner.trim().toLowerCase() && r.name.toLowerCase() === name.trim().toLowerCase())) {
      alert('This repository space ecosystem link target target is already being actively tracked.');
      return;
    }
    
    addRepo(owner.trim(), name.trim());
    setNewRepo('');
  };

  // --- RENDERING PATH A: UNAUTHENTICATED STATE ---
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-50 font-sans">
        <div className="text-center p-8 max-w-md border border-zinc-800 rounded-xl bg-zinc-900/50 backdrop-blur">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-emerald-400">OctoTriage</h1>
          <p className="text-sm text-zinc-400 mb-6">Aggregated real-time workflow priority views for open source maintainers.</p>
          <button 
            onClick={handleLoginRedirect} 
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg transition-all shadow-lg shadow-emerald-500/10"
          >
            Connect GitHub Account
          </button>
        </div>
      </div>
    );
  }

  const columnsData = getCategorizedColumns();

  // --- RENDERING PATH B: AUTHENTICATED ACTIVE RUNTIME STATE ---
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar Control Deck */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/40 p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-lg font-bold text-emerald-400 tracking-tight">OctoTriage Engine</h2>
          </div>
          
          <form onSubmit={handleAddRepoSubmit} className="mb-6">
            <input
              type="text"
              placeholder="e.g. facebook/react"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-emerald-500 text-zinc-200 placeholder-zinc-600"
            />
            <button type="submit" className="w-full mt-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded-lg font-medium border border-zinc-700 transition">
              + Track Project Repo
            </button>
          </form>
          
          <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-250px)]">
            <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-2 px-1">Active Scopes</p>
            {trackedRepos.length === 0 && <p className="text-xs text-zinc-600 italic px-1">Add repos to map streams.</p>}
            {trackedRepos.map((repo, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs bg-zinc-900/60 hover:bg-zinc-900 px-3 py-2 rounded-lg border border-zinc-800/60 group transition">
                <span className="truncate text-zinc-400 font-mono">{repo.owner}/{repo.name}</span>
                <button onClick={() => removeRepo(repo.owner, repo.name)} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
              </div>
            ))}
          </div>
        </div>
        
        <button onClick={logout} className="text-left text-xs text-zinc-600 hover:text-zinc-400 font-medium py-2 px-1 transition">
          Disconnect Session
        </button>
      </aside>

      {/* Main Kanban Workspace Surface Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/20">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-zinc-200">Unified Streams</div>
            {isLoading && <div className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded animate-pulse">Syncing...</div>}
          </div>
          {error && <div className="text-xs text-red-400 truncate max-w-md bg-red-950/20 px-3 py-1 rounded border border-red-900/30">{error}</div>}
        </header>

        {/* Dynamic Column Render Deck */}
        <section className="flex-1 p-6 flex gap-4 overflow-x-auto items-start bg-zinc-950">
          {Object.entries(columnsData).map(([columnName, itemsList]) => (
            <div key={columnName} className="w-80 flex-shrink-0 bg-zinc-900/20 border border-zinc-900 rounded-xl p-3 flex flex-col max-h-full">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-bold text-zinc-400 tracking-wide">{columnName}</span>
                <span className="bg-zinc-900 text-zinc-400 text-[10px] px-2 py-0.5 rounded-md font-mono border border-zinc-800">{itemsList.length}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-[150px]">
                {itemsList.length === 0 ? (
                  <div className="h-24 border border-dashed border-zinc-900 rounded-lg flex items-center justify-center p-4">
                    <p className="text-[11px] text-zinc-600 text-center italic">Clear channel grid.</p>
                  </div>
                ) : (
                  itemsList.map((item) => (
                    <a 
                      key={item.id} 
                      href={item.url} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="block p-3 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg transition dynamic-card group text-left"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mb-1">
                        <span className="truncate max-w-[150px]">{item.repoOwner}/{item.repoName}</span>
                        <span>#{item.number}</span>
                      </div>
                      
{item.title}
<span className={text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${item.type === 'PR' ? 'bg-purple-950/40 text-purple-400 border border-purple-900/30' : 'bg-blue-950/40 text-blue-400 border border-blue-900/30'}}>
{item.type}

{item.labels.slice(0, 2).map((lbl, lIdx) => (
<span
key={lIdx}
className="text-[9px] px-1.5 py-0.2 rounded border border-zinc-800 font-medium text-zinc-400 max-w-[80px] truncate"
style={{ borderLeftColor: #${lbl.color}, borderLeftWidth: '3px' }}
>
{lbl.name}

))}
By @{item.author.login}
{new Date(item.updatedAt).toLocaleDateString(undefined, {month:'short', day:'numeric'})}


))
)}


))}



);
}
