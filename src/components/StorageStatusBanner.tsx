'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { AlertTriangle, Download, RefreshCw, AlertCircle } from 'lucide-react';

export function StorageStatusBanner() {
  const {
    storageStatus,
    storageError,
    retrySave,
    exportDatabaseJSON,
    recoveryCopySaved,
    recoveryKey,
    recoveryRawData,
    downloadRawRecoveryData,
  } = useApp();

  if (storageStatus === 'OK' || storageStatus === 'LOADING') {
    return null;
  }

  if (storageStatus === 'RECOVERY_REQUIRED') {
    return (
      <div className="w-full bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-3 transition-all duration-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-sm font-semibold">Chế độ phục hồi dữ liệu an toàn</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                {storageError || 'Dữ liệu trước đó không hợp lệ hoặc cấu trúc bị lỗi.'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-mono">
                {recoveryCopySaved
                  ? `Bản sao lưu dự phòng: ${recoveryKey} đã được lưu thành công. Khóa lưu trữ gốc được bảo toàn nguyên vẹn.`
                  : 'Cảnh báo: Không thể tạo bản sao trong localStorage (hạn mức đã đầy). Khóa gốc vẫn được bảo toàn nguyên vẹn.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0">
            {recoveryRawData && (
              <button
                onClick={downloadRawRecoveryData}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold shadow-sm transition-colors"
                title="Tải về dữ liệu gốc bị hỏng/không hợp lệ để phục hồi thủ công"
              >
                <Download className="w-3.5 h-3.5" />
                Download dữ liệu gốc để phục hồi
              </button>
            )}
            <button
              onClick={exportDatabaseJSON}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium shadow-sm transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Xuất dữ liệu hiện tại
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (storageStatus === 'SAVE_ERROR') {
    return (
      <div className="w-full bg-rose-500/10 border-b border-rose-500/30 text-rose-900 dark:text-rose-200 px-4 py-3 transition-all duration-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-sm font-semibold">Lỗi lưu trữ dữ liệu cục bộ</p>
              <p className="text-xs text-rose-800 dark:text-rose-300 mt-0.5">
                {storageError || 'Không thể ghi dữ liệu vào localStorage (có thể vượt quá hạn mức). Dữ liệu chỉ đang lưu trên RAM.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <button
              onClick={retrySave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium shadow-sm transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử lưu lại
            </button>
            <button
              onClick={exportDatabaseJSON}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium shadow-sm transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Xuất bản sao lưu ngay
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
