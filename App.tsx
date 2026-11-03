// Draft 

import React, { useState } from 'react';
import { useAppStore } from './store/useAppStore';
import OAuthCallback from './features/auth/components/OAuthCallback';

export default function App() {
  const { token, trackedRepos, setToken, addRepo, removeRepo, logout } = useAppStore();
  const [newRepo, setNewRepo] = useState('');

  // Simulating standard GitHub OAuth flow redirect for prototype purposes
  const handleLoginMock = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID';
    window.location.href = `https://github.com{clientId}&scope=repo`;
  };

  const handleAddRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepo.includes('/')) return alert('Please enter format as: owner/repo');
    const [owner, name] = newRepo.split('/');
    addRepo(owner.trim(), name.trim());
    setNewRepo('');
  };

    // Check if current browser window location string is on the oauth redirect path
  if (window.location.pathname === '/callback') {
    return <OAuthCallback />;
  }
  
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-50 font-sans">
        <div className="text-center p-8 max-w-md border border-zinc-800 rounded-xl bg-zinc-900/50 backdrop-blur">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-emerald-400">OctoTriage</h1>
          <p className="text-sm text-zinc-400 mb-6">Aggregated real-time inbox management for open source maintainers.</p>
          <button 
            onClick={handleLoginMock} 
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg transition-all"
          >
            Connect GitHub Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Navigation & Target Repos Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/40 p-4 flex flex-col justify-between">
        <div>
          <h2 className="text-lg font-bold text-emerald-400 mb-4 tracking-tight">OctoTriage Dashboard</h2>
          <form onSubmit={handleAddRepoSubmit} className="mb-6">
            <input
              type="text"
              placeholder="facebook/react"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-emerald-500 text-zinc-200"
            />
            <button type="submit" className="w-full mt-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1 rounded font-medium border border-zinc-700 transition">
              + Track Repository
            </button>
          </form>
          
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-2">Monitored Repos</p>
            {trackedRepos.length === 0 && <p className="text-xs text-zinc-500 italic">No repos added yet.</p>}
            {trackedRepos.map((repo, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs bg-zinc-900/80 px-2 py-1.5 rounded border border-zinc-800/60 group">
                <span className="truncate text-zinc-300">{repo.owner}/{repo.name}</span>
                <button onClick={() => removeRepo(repo.owner, repo.name)} className="text-zinc-500 hover:text-red-400 text-[10px]">✕</button>
              </div>
            ))}
          </div>
        </div>
        
        <button onClick={logout} className="text-left text-xs text-zinc-500 hover:text-zinc-300 font-medium py-2">
          Logout Session
        </button>
      </aside>

      {/* Main Core Kanban Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/20">
          <div className="text-sm font-semibold text-zinc-200">Unified Triage Stream</div>
          <div className="text-xs bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-emerald-400 font-mono">
            API Token Live
          </div>
        </header>

        {/* Prototype Kanban Columns Grid view */}
        <section className="flex-1 p-6 flex gap-4 overflow-x-auto items-start">
          {['Unassigned / Incoming', 'Needs Review', 'Stale Alert (7d+)', 'Action Blocked'].map((columnName, index) => (
            <div key={index} className="w-80 flex-shrink-0 bg-zinc-900/30 border border-zinc-800/80 rounded-xl p-3 flex flex-col max-h-full">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">{columnName}</span>
                <span className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">0</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px] border border-dashed border-zinc-800/40 rounded-lg flex items-center justify-center p-4">
                <p className="text-xs text-zinc-600 text-center italic">Connect your API metrics to populate active cards.</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
