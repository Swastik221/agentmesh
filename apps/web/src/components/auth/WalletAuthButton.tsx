import { Wallet, LogOut, ShieldCheck, Loader2 } from 'lucide-react';
import { Pill, TruncatedAddress } from '@agentmesh/ui';
import { useAuth } from '../../hooks/useAuth';

export function WalletAuthButton() {
  const { user, connectedAddress, status, error, connectWallet, loginWithSiwe, logout } = useAuth();

  if (status === 'authenticated' && user?.walletAddress) {
    return (
      <div className="flex items-center gap-2">
        <Pill tone="success" dot>
          SIWE Verified
        </Pill>
        <TruncatedAddress address={user.walletAddress} className="app-header__wallet" />
        <button
          onClick={logout}
          title="Sign out"
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          <LogOut size={14} />
          <span>Logout</span>
        </button>
      </div>
    );
  }

  if (status === 'connected_unauthenticated') {
    return (
      <div className="flex items-center gap-2">
        {connectedAddress && (
          <TruncatedAddress address={connectedAddress} className="app-header__wallet" />
        )}
        <button
          onClick={loginWithSiwe}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm"
        >
          <ShieldCheck size={14} />
          <span>Sign In with Ethereum</span>
        </button>
      </div>
    );
  }

  if (status === 'connecting' || status === 'authenticating') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 size={14} className="animate-spin text-indigo-400" />
        <span>{status === 'connecting' ? 'Connecting Wallet...' : 'Verifying SIWE...'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400 max-w-[150px] truncate">{error}</span>}
      <button
        onClick={connectWallet}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
      >
        <Wallet size={14} className="text-indigo-400" />
        <span>Connect Wallet</span>
      </button>
    </div>
  );
}
