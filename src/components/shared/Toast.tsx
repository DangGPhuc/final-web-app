'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export function Toast() {
  const { toast } = useApp();

  if (!toast) return null;

  const isSuccess = toast.type === 'success';
  const isError = toast.type === 'error';

  return (
    <div className="fixed bottom-20 md:bottom-6 right-6 z-50 animate-fade-in max-w-sm">
      <div
        className={`px-4 py-3 rounded-xl border flex items-center gap-3 backdrop-blur-md shadow-2xl ${
          isSuccess
            ? 'bg-[#17181a]/95 border-[#10b981]/40 text-[#10b981]'
            : isError
            ? 'bg-[#17181a]/95 border-[#f43f5e]/40 text-[#f43f5e]'
            : 'bg-[#17181a]/95 border-[#232427] text-[#f5f5f7]'
        }`}
      >
        {isSuccess && <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#10b981]" />}
        {isError && <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#f43f5e]" />}
        {!isSuccess && !isError && <Info className="w-4 h-4 flex-shrink-0 text-[#00b3dd]" />}
        <div className="text-xs font-medium text-[#f5f5f7]">{toast.text}</div>
      </div>
    </div>
  );
}
