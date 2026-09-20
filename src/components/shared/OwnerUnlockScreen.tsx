'use client';

import React, { useState } from 'react';
import { Lock, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export function OwnerUnlockScreen() {
  const { unlockCockpit } = useApp();
  const [keyInput, setKeyInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const enteredKey = keyInput;
    // Wipe local state input immediately
    setKeyInput('');

    try {
      const result = await unlockCockpit(enteredKey);
      if (!result.success) {
        setErrorMsg(result.error || 'Khóa chủ sở hữu không chính xác.');
      }
    } catch {
      setErrorMsg('Không thể kết nối đến máy chủ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090a0b] text-[#9f9fa0] flex flex-col items-center justify-center p-4 antialiased selection:bg-[#232427] selection:text-white">
      <div className="w-full max-w-md bg-[#121316] border border-[#232427] rounded-2xl p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        {/* Subtle decorative glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center mb-8 relative">
          <div className="w-14 h-14 rounded-2xl bg-[#1c1d22] border border-[#2d2f36] flex items-center justify-center mx-auto mb-4 text-emerald-400 shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            Personal Finance Cockpit
          </h1>
          <p className="text-xs text-[#828288] mt-1.5 font-medium">
            Không gian tài chính cá nhân được bảo vệ.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-[#71717a] mb-2">
              Khóa truy cập chủ sở hữu (Owner Access Key)
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="Nhập khóa OWNER_SECRET_KEY..."
              autoFocus
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#0b0c0e] border border-[#27282d] text-sm text-white placeholder-[#45454a] focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={!keyInput.trim() || isSubmitting}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-medium text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xác thực...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Mở khóa Cockpit</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-[#1e1f24] text-center">
          <p className="text-[11px] text-[#52525b] leading-relaxed">
            Kiến trúc Single-Owner • Phiên làm việc được bảo mật qua cookie HTTP-only SameSite.
          </p>
        </div>
      </div>
    </div>
  );
}
