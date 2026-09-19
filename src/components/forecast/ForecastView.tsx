'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  calculateSavingsProjection,
  formatCurrency,
  formatMonthLabel,
} from '@/lib/finance/calculations';
import {
  TrendingUp,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

export function ForecastView() {
  const { monthlySnapshots, balance } = useApp();

  const [horizonMonths, setHorizonMonths] = useState<number>(12);

  // Cumulative savings from snapshots
  const cumulativeHistoricalSavings = useMemo(() => {
    return monthlySnapshots.reduce((s, snap) => s + snap.netSavings, 0);
  }, [monthlySnapshots]);

  // Compute projection
  const projection = useMemo(() => {
    return calculateSavingsProjection(
      monthlySnapshots,
      cumulativeHistoricalSavings,
      horizonMonths
    );
  }, [monthlySnapshots, cumulativeHistoricalSavings, horizonMonths]);

  // Transform projection data for Recharts (separate actual vs forecast keys for distinct styling)
  const chartData = useMemo(() => {
    // We want the connection point between actual and forecast to be seamless
    const lastActual = projection.projections.filter(p => p.isActual).slice(-1)[0];

    return projection.projections.map(p => {
      if (p.isActual) {
        return {
          month: formatMonthLabel(p.month),
          rawMonth: p.month,
          'Thực tế (Actual)': p.projected,
          'Dự báo (Forecast)': null,
        };
      } else {
        return {
          month: formatMonthLabel(p.month),
          rawMonth: p.month,
          'Thực tế (Actual)': null,
          'Dự báo (Forecast)': p.projected,
        };
      }
    });
  }, [projection]);

  // Final projected value
  const finalProjectedValue = useMemo(() => {
    const pts = projection.projections;
    return pts.length > 0 ? pts[pts.length - 1].projected : 0;
  }, [projection]);

  const isNegativeTrajectory = projection.averageMonthlySavings < 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">
            Dự báo tích lũy
          </h1>
          <p className="text-xs text-[#9f9fa0] mt-1">
            Mô hình toán học dự phóng số dư tích lũy dựa trên dữ liệu các tháng đã chốt sổ
          </p>
        </div>

        {/* Horizon selector buttons */}
        <div className="flex items-center gap-1 bg-[#17181a] p-1 rounded-xl border border-[#232427]">
          <span className="text-[11px] text-[#9f9fa0] px-2 font-mono-data">KỲ HẠN:</span>
          {[3, 6, 12, 24].map(months => (
            <button
              key={months}
              onClick={() => setHorizonMonths(months)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                horizonMonths === months
                  ? 'bg-[#ffffff] text-[#000000] font-medium'
                  : 'text-[#9f9fa0] hover:text-[#f5f5f7]'
              }`}
            >
              {months}T
            </button>
          ))}
        </div>
      </div>

      {/* Transparent Disclaimer & Data Basis Banner */}
      <div className="p-4 rounded-xl bg-[#17181a] border border-[#232427] flex items-start gap-3">
        <Info className="w-4 h-4 text-[#00b3dd] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#9f9fa0] space-y-1">
          <div className="text-[#f5f5f7] font-medium">
            {projection.monthsOfData > 0
              ? `Dự báo đang dựa trên ${projection.monthsOfData} tháng dữ liệu thực tế đã chốt sổ.`
              : 'Chưa có tháng nào được chốt sổ. Hãy vào tab Quỹ và bấm "Chốt sổ tháng" để bắt đầu ghi nhận dữ liệu thực tế.'}
          </div>
          <div>
            Công thức dự phóng tuyến tính: <code className="font-mono text-[#f5f5f7]">Tích lũy[N] = Tích lũy hiện tại + (Tiết kiệm TB/tháng × N)</code>.
            Dự báo không phải là cam kết kết quả tài chính chắc chắn.
          </div>
        </div>
      </div>

      {/* Negative Trajectory Warning if applicable */}
      {isNegativeTrajectory && (
        <div className="p-4 rounded-xl bg-[#f43f5e]/10 border border-[#f43f5e]/30 flex items-start gap-3 text-[#f43f5e]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="font-semibold">Cảnh báo thâm hụt tài chính:</div>
            <div>
              Mức tiết kiệm trung bình hàng tháng của bạn đang mang giá trị âm (-{formatCurrency(Math.abs(projection.averageMonthlySavings))}).
              Đường dự phóng phản ánh đúng chiều hướng suy giảm vốn theo thời gian nếu không điều chỉnh chi tiêu.
            </div>
          </div>
        </div>
      )}

      {/* Metrics Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            SỐ THÁNG DỮ LIỆU THỰC TẾ
          </div>
          <div className="text-2xl font-light text-[#f5f5f7] font-mono">
            {projection.monthsOfData} tháng
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            Dữ liệu snapshot đã khóa
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            TIẾT KIỆM TÍCH LŨY HIỆN TẠI
          </div>
          <div
            className={`text-2xl font-light font-mono ${
              cumulativeHistoricalSavings >= 0 ? 'text-[#f5f5f7]' : 'text-[#f43f5e]'
            }`}
          >
            {formatCurrency(cumulativeHistoricalSavings)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            Tổng net savings các tháng qua
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            TIẾT KIỆM TRUNG BÌNH / THÁNG
          </div>
          <div
            className={`text-2xl font-light font-mono ${
              projection.averageMonthlySavings >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
            }`}
          >
            {projection.averageMonthlySavings >= 0 ? '+' : ''}
            {formatCurrency(projection.averageMonthlySavings)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            {projection.monthsOfData > 0 ? `Bình quân ${projection.monthsOfData} tháng` : 'Chưa có dữ liệu'}
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            DỰ KIẾN SAU {horizonMonths} THÁNG
          </div>
          <div
            className={`text-2xl font-light font-mono ${
              finalProjectedValue >= 0 ? 'text-[#00b3dd]' : 'text-[#f43f5e]'
            }`}
          >
            {formatCurrency(finalProjectedValue)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            Sau {horizonMonths} tháng tiếp theo
          </div>
        </div>
      </div>

      {/* Projection Chart */}
      <div className="cockpit-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-medium text-[#f5f5f7]">
              Biểu đồ đối chiếu Thực tế & Dự phóng tương lai
            </h2>
            <p className="text-[11px] text-[#9f9fa0]">
              Đường nét liền: Kết quả tích lũy thực tế • Đường nét đứt: Dự phóng {horizonMonths} tháng tới
            </p>
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232427" vertical={false} />
              <XAxis dataKey="month" stroke="#9f9fa0" fontSize={11} tickLine={false} />
              <YAxis
                stroke="#9f9fa0"
                fontSize={11}
                tickLine={false}
                tickFormatter={val => (Math.abs(val) >= 1000000 ? `${val / 1000000}M` : `${val / 1000}k`)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#17181a',
                  border: '1px solid #34363a',
                  borderRadius: '10px',
                  color: '#f5f5f7',
                  fontSize: '12px',
                }}
                formatter={(val: any) => formatCurrency(Number(val) || 0)}
              />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#9f9fa0' }} />
              {/* Actual historical line */}
              <Line
                type="monotone"
                dataKey="Thực tế (Actual)"
                stroke="#ffffff"
                strokeWidth={2}
                dot={{ r: 4, fill: '#ffffff' }}
                connectNulls={false}
              />
              {/* Future projected line */}
              <Line
                type="monotone"
                dataKey="Dự báo (Forecast)"
                stroke="#00b3dd"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#00b3dd' }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Historical Monthly Breakdown Table */}
      {monthlySnapshots.length > 0 && (
        <div className="cockpit-card p-6">
          <h3 className="text-sm font-medium text-[#f5f5f7] mb-3">Lịch sử các tháng đã chốt sổ</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#232427] text-[#9f9fa0] font-mono-data">
                  <th className="pb-3 pr-4">THÁNG</th>
                  <th className="pb-3 pr-4 text-right">TỔNG THU (IN)</th>
                  <th className="pb-3 pr-4 text-right">TỔNG CHI (OUT)</th>
                  <th className="pb-3 pr-4 text-right">NET TIẾT KIỆM</th>
                  <th className="pb-3 pr-4 text-right">KẾT QUẢ CÁC QUỸ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232427]">
                {monthlySnapshots.map(s => (
                  <tr key={s.month} className="hover:bg-[#1f2022]/40">
                    <td className="py-3 pr-4 font-mono font-medium text-[#f5f5f7]">
                      {formatMonthLabel(s.month)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-[#10b981]">
                      +{formatCurrency(s.totalIncome)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-[#f43f5e]">
                      -{formatCurrency(s.totalExpense)}
                    </td>
                    <td
                      className={`py-3 pr-4 text-right font-mono font-medium ${
                        s.netSavings >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
                      }`}
                    >
                      {s.netSavings >= 0 ? '+' : ''}
                      {formatCurrency(s.netSavings)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[#9f9fa0]">
                      {s.fundResults?.length || 0} quỹ đã hạch toán
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
